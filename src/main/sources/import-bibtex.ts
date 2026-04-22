/**
 * Bulk import from BibTeX (#98).
 *
 * Reads a `.bib` file, parses every entry, maps it into the same
 * `ArticleMetadata` shape the identifier-ingest adapters already produce,
 * derives a canonical source id (DOI > arXiv > ISBN > URL > content hash),
 * and writes a `meta.ttl` per entry under `.minerva/sources/<id>/`.
 *
 * Dedupe semantics match URL + identifier ingest: if the target folder
 * already has a `meta.ttl`, we skip without overwriting.
 *
 * Scope limits for this pass:
 *   - BibTeX only. Zotero RDF export is a separate parser; same target
 *     shape once parsed, but this ticket ships BibTeX first.
 *   - No attached-PDF handling. BibTeX proper doesn't carry attachments;
 *     Zotero's RDF variant does, and that path lands in the follow-up.
 *   - No `readStatus`. Deferred until an in-app reading-progress UI
 *     exists to consume it.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { parse as parseBibtex } from '@retorquere/bibtex-parser';
import { canonicalSourceId } from './source-id';
import { buildMetaTtl } from './ingest-identifier';
import type { ArticleMetadata } from './api-adapters/types';

export interface BibtexImportProgress {
  done: number;
  total: number;
  /** Title of the entry just processed — gives the UI something to display. */
  currentTitle: string;
}

export interface BibtexImportResult {
  imported: Array<{ sourceId: string; title: string }>;
  duplicate: Array<{ sourceId: string; title: string }>;
  failed: Array<{ key: string; reason: string }>;
  /** Count of entries the parser couldn't parse at all; these never reach per-entry handling. */
  parseErrors: number;
  /** Total entries the parser emitted — sum of imported + duplicate + failed. */
  totalEntries: number;
}

export interface BibtexImportOptions {
  /** Fires after each entry finishes processing. Sync; keep it cheap. */
  onProgress?: (progress: BibtexImportProgress) => void;
}

/**
 * Parse a BibTeX file from disk and import every entry. Per-entry failures
 * (mapping, write) are captured in `failed` rather than thrown so a single
 * malformed entry in a 5000-entry export doesn't abort the whole import.
 */
export async function importBibtex(
  rootPath: string,
  bibAbsolutePath: string,
  options: BibtexImportOptions = {},
): Promise<BibtexImportResult> {
  const content = await fs.readFile(bibAbsolutePath, 'utf-8');
  return importBibtexContent(rootPath, content, options);
}

export async function importBibtexContent(
  rootPath: string,
  content: string,
  options: BibtexImportOptions = {},
): Promise<BibtexImportResult> {
  const { entries, errors } = parseBibtex(content, {
    // Preserve author-supplied title casing — BibTeX parsers default to
    // English sentence-case, which mangles proper nouns and acronyms.
    sentenceCase: false,
  });

  const result: BibtexImportResult = {
    imported: [],
    duplicate: [],
    failed: [],
    parseErrors: errors?.length ?? 0,
    totalEntries: entries.length,
  };

  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    let titleForProgress = entry.key;
    try {
      const metadata = mapBibtexEntry(entry);
      titleForProgress = metadata.title;

      const { id: sourceId } = canonicalSourceId(
        {
          doi: metadata.doi ?? undefined,
          arxiv: metadata.arxiv ?? undefined,
          pubmed: metadata.pubmed ?? undefined,
          isbn: metadata.isbn ?? undefined,
          url: metadata.uri ?? undefined,
        },
        // Hash-of-the-entry fallback: the parser reliably round-trips
        // `entry.input`, so two imports of the same BibTeX row collapse
        // even when the entry has no DOI / ISBN / URL to key on.
        entry.input ?? `${entry.type}:${entry.key}:${metadata.title}`,
      );

      const sourceDir = path.join(rootPath, '.minerva', 'sources', sourceId);
      const metaPath = path.join(sourceDir, 'meta.ttl');

      try {
        await fs.access(metaPath);
        result.duplicate.push({ sourceId, title: metadata.title });
        continue;
      } catch { /* not found — proceed */ }

      await fs.mkdir(sourceDir, { recursive: true });
      await fs.writeFile(metaPath, buildMetaTtl(metadata), 'utf-8');
      result.imported.push({ sourceId, title: metadata.title });
    } catch (err) {
      result.failed.push({
        key: entry.key,
        reason: err instanceof Error ? err.message : String(err),
      });
    } finally {
      options.onProgress?.({
        done: i + 1,
        total: entries.length,
        currentTitle: titleForProgress,
      });
    }
  }

  return result;
}

// ── BibTeX → ArticleMetadata ────────────────────────────────────────────────

interface BibtexAuthor {
  firstName?: string;
  lastName?: string;
  suffix?: string;
  // Name-as-entered ("van der Waals"). The parser unwinds standard BibTeX
  // name parts; anything weird falls back to a single literal field.
  literal?: string;
}

interface BibtexEntryShape {
  type: string;
  key: string;
  fields: Record<string, unknown>;
  input?: string;
}

/**
 * Map a parsed BibTeX entry to the `ArticleMetadata` shape the rest of the
 * ingest pipeline consumes. Fields that aren't present in the entry collapse
 * to null; the downstream TTL builder omits them.
 */
export function mapBibtexEntry(entry: BibtexEntryShape): ArticleMetadata {
  const f = entry.fields;

  const title = asString(f.title) ?? '(untitled)';
  const creators = parseAuthors(f.author) ?? [];
  const issued = extractIssuedDate(f);
  const publisher = asString(f.publisher);
  const containerTitle =
    asString(f.journal) ??
    asString(f.booktitle) ??
    asString(f.series) ??
    null;
  const abstract = asString(f.abstract);

  const doi = asString(f.doi);
  // BibTeX convention for arXiv: `eprint = {2301.12345}` with
  // `archiveprefix = {arXiv}`. Fall back to accepting any `eprint` since
  // many exports omit archiveprefix.
  const arxiv = normalizeArxivLike(asString(f.eprint));
  const isbn = asString(f.isbn);
  const pubmed = asString(f.pmid);
  const uri = asString(f.url) ?? asString(f.howpublished) ?? null;

  return {
    subtype: subtypeFor(entry.type, f),
    title,
    creators,
    abstract: abstract ?? null,
    issued: issued ?? null,
    publisher: publisher ?? null,
    containerTitle,
    doi: doi ?? null,
    isbn: isbn ?? null,
    arxiv,
    pubmed: pubmed ?? null,
    uri: uri ?? null,
    pdfUrl: null,
    category: null,
  };
}

function subtypeFor(type: string, fields: Record<string, unknown>): ArticleMetadata['subtype'] {
  const t = type.toLowerCase();
  if (t === 'book' || t === 'booklet' || t === 'inbook' || t === 'incollection') return 'Book';
  if (t === 'techreport' || t === 'manual') return 'Report';
  if (t === 'unpublished') return 'Preprint';
  // @misc with an eprint field is the canonical arXiv-preprint shape.
  if (t === 'misc' && fields.eprint) return 'Preprint';
  if (t === 'article' || t === 'inproceedings' || t === 'conference') return 'Article';
  return 'Source';
}

function asString(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const trimmed = v.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * BibTeX authors come out of the parser as `{firstName, lastName, suffix, literal}[]`.
 * Stringify to "First Last" with a trailing suffix, or fall back to the
 * literal when the parser couldn't split the name (e.g. a corporate author
 * or a single-word literal like "{Anonymous}").
 */
export function parseAuthors(raw: unknown): string[] | null {
  if (!Array.isArray(raw)) return null;
  const out: string[] = [];
  for (const a of raw as BibtexAuthor[]) {
    if (a.literal) {
      out.push(a.literal);
      continue;
    }
    const parts: string[] = [];
    if (a.firstName) parts.push(a.firstName);
    if (a.lastName) parts.push(a.lastName);
    if (a.suffix) parts.push(a.suffix);
    const joined = parts.join(' ').trim();
    if (joined) out.push(joined);
  }
  return out;
}

/**
 * Compose an ISO date from the BibTeX `year` / `month` / `date` fields,
 * handling the common conventions: year-only, year-month (where month is
 * either a short name or a digit), or a full `date = {2024-10-15}`.
 */
export function extractIssuedDate(fields: Record<string, unknown>): string | null {
  const date = asString(fields.date);
  if (date && /^\d{4}(-\d{2}(-\d{2})?)?$/.test(date)) return date;

  const year = asString(fields.year);
  if (!year || !/^\d{4}$/.test(year)) return null;

  const month = asString(fields.month);
  if (!month) return year;
  const monthNum = monthToNumber(month);
  if (monthNum == null) return year;
  return `${year}-${String(monthNum).padStart(2, '0')}`;
}

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

function monthToNumber(raw: string): number | null {
  const trimmed = raw.trim().toLowerCase();
  if (/^\d{1,2}$/.test(trimmed)) {
    const n = parseInt(trimmed, 10);
    return n >= 1 && n <= 12 ? n : null;
  }
  const key = trimmed.slice(0, 3);
  return MONTH_MAP[key] ?? null;
}

function normalizeArxivLike(raw: string | null): string | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  // New-style arXiv id: YYMM.NNNNN(N)
  if (/^\d{4}\.\d{4,5}$/.test(trimmed)) return trimmed;
  // Old-style: archive/yymmNNN — accept as-is; canonicalSourceId normalises.
  if (/^[a-z-]+(?:\.[a-z-]+)?\/\d{7}$/i.test(trimmed)) return trimmed;
  return null;
}
