/**
 * Mine a source's References section into stub Source nodes (#106).
 *
 * Two-phase parser:
 *   1. Locate the references-list section in the source's body.md by
 *      scanning for a "References" / "Bibliography" / "Works Cited"
 *      heading. Take everything from that heading to the next
 *      heading-of-equal-or-lower-depth (or EOF).
 *   2. Split the section into per-entry raw strings (numbered list,
 *      bulleted list, or paragraph-per-entry). Hand each entry to
 *      the LLM with a JSON-output prompt so the model maps the
 *      free-form citation into structured `{ title, authors, year,
 *      doi, … }` records.
 *
 * Trust principle (CLAUDE.md): the mining call itself doesn't write
 * to disk. It returns the parsed candidates so the renderer can
 * surface a "approve N of these" dialog. The user confirms before
 * any stub source is created — same pattern as the Auto-link
 * suggestions dialog.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { complete } from '../llm';
import type { ParsedReference } from '../../shared/mine-references';

export type { ParsedReference } from '../../shared/mine-references';

export interface MineReferencesOptions {
  /** Dependency-injection seam for tests. Default is the real LLM. */
  llmComplete?: (prompt: string) => Promise<string>;
  /** Maximum entries to send to the LLM per call. Paginated when a
   *  bibliography exceeds this — the prompt+response budget at large
   *  N gets uncomfortable. Default: 30. */
  batchSize?: number;
}

const DEFAULT_BATCH_SIZE = 30;

/**
 * High-level orchestrator: read body.md, find the references section,
 * split into raw entries, call the LLM for structured parsing, return
 * the candidates. The renderer then surfaces them for user approval
 * before any stub gets written.
 */
export async function mineSourceReferences(
  rootPath: string,
  sourceId: string,
  opts: MineReferencesOptions = {},
): Promise<ParsedReference[]> {
  const bodyPath = path.join(rootPath, '.minerva', 'sources', sourceId, 'body.md');
  let body: string;
  try {
    body = await fs.readFile(bodyPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Source has no body.md to mine: ${sourceId}`, { cause: err });
    }
    throw err;
  }

  const section = extractReferenceSection(body);
  if (!section) {
    throw new Error('No "References" / "Bibliography" / "Works Cited" section found in body.md');
  }
  const entries = splitReferenceEntries(section);
  if (entries.length === 0) {
    throw new Error('Reference section found but no individual entries could be split out.');
  }

  const llm = opts.llmComplete ?? complete;
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const results: ParsedReference[] = [];
  for (let i = 0; i < entries.length; i += batchSize) {
    const batch = entries.slice(i, i + batchSize);
    const parsed = await parseBatchWithLLM(batch, llm);
    for (const p of parsed) {
      if (p.title.trim()) results.push(p);
    }
  }
  return results;
}

// ── Section + entry extraction ───────────────────────────────────────────

const REF_HEADING_RE = /^(#{1,6})\s+(References|Bibliography|Works\s+Cited|Literature\s+Cited|Cited\s+Works|Citations)\s*$/im;

/**
 * Return the body of the first "References" section, or null. We grab
 * from the line *after* the heading up to (but not including) the
 * next heading at the same or shallower depth.
 *
 * Exposed for tests.
 */
export function extractReferenceSection(body: string): string | null {
  const m = body.match(REF_HEADING_RE);
  if (!m) return null;
  const headingMarker = m[1];
  const headingDepth = headingMarker.length;
  // Index of the line right after the heading.
  const startIdx = (m.index ?? 0) + m[0].length;
  // Scan forward for the next heading of equal-or-shallower depth.
  const rest = body.slice(startIdx);
  const nextHeadingRe = new RegExp(`^(#{1,${headingDepth}})\\s+\\S`, 'm');
  const nextMatch = rest.match(nextHeadingRe);
  const section = nextMatch
    ? rest.slice(0, nextMatch.index ?? rest.length)
    : rest;
  const trimmed = section.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/**
 * Split a references-section blob into per-entry raw strings.
 * Strategies tried in order:
 *   1. Numbered lines:   `1.` / `1)` / `[1]` at the start of a line.
 *   2. Bulleted lines:   `-` / `*` / `•` at the start.
 *   3. Blank-line separated paragraphs.
 *
 * The first strategy that yields >1 entry wins. Falling back to
 * paragraph split catches the most common "References:\n\nSmith…
 * \n\nJones…" style.
 *
 * Exposed for tests.
 */
export function splitReferenceEntries(section: string): string[] {
  // Strategy 1: numbered / bracketed prefixes.
  const numbered = splitOnLeadingMarker(section, /^\s*(?:\[\d+\]|\(\d+\)|\d+[.)])\s+/m);
  if (numbered.length > 1) return numbered.map(stripWhitespace).filter(Boolean);

  // Strategy 2: bullets.
  const bulleted = splitOnLeadingMarker(section, /^\s*[-*•]\s+/m);
  if (bulleted.length > 1) return bulleted.map(stripWhitespace).filter(Boolean);

  // Strategy 3: blank-line paragraphs.
  return section.split(/\n\s*\n+/).map(stripWhitespace).filter(Boolean);
}

function splitOnLeadingMarker(text: string, marker: RegExp): string[] {
  // Find all marker positions; split between them.
  const positions: number[] = [];
  const g = new RegExp(marker.source, marker.flags.includes('g') ? marker.flags : `${marker.flags}g`);
  let m: RegExpExecArray | null;
  while ((m = g.exec(text)) !== null) {
    positions.push(m.index);
    // Avoid infinite loop on zero-width matches.
    if (m.index === g.lastIndex) g.lastIndex++;
  }
  if (positions.length === 0) return [text];
  const out: string[] = [];
  for (let i = 0; i < positions.length; i++) {
    const start = positions[i];
    const end = i + 1 < positions.length ? positions[i + 1] : text.length;
    let chunk = text.slice(start, end);
    // Drop the marker prefix so the LLM doesn't have to chew on it.
    chunk = chunk.replace(marker, '');
    out.push(chunk);
  }
  return out;
}

function stripWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

// ── LLM-assisted entry parsing ───────────────────────────────────────────

const SYSTEM_PROMPT_HEADER = `You are parsing a reference list from an academic paper.
For each raw citation, extract the bibliographic fields you can recognise.
Return a JSON array — one object per input citation, in the same order.

Each object has these fields. Use null when a field isn't determinable.

  {
    "raw": "<verbatim input citation>",
    "title": "<paper / book / chapter title>",
    "authors": ["Last, F.", "..."],
    "year": "2023",
    "containerTitle": "<journal / book / proceedings>",
    "doi": "10.NNNN/...",
    "arxiv": "2301.12345",
    "pubmed": "12345678",
    "isbn": "978-...",
    "url": "https://...",
    "subtype": "Article" | "Book" | "Preprint" | "Report" | "Source"
  }

Output ONLY the JSON array — no prose, no markdown fence, no comments.`;

async function parseBatchWithLLM(
  entries: string[],
  llm: (prompt: string) => Promise<string>,
): Promise<ParsedReference[]> {
  const numbered = entries.map((e, i) => `${i + 1}. ${e}`).join('\n\n');
  const prompt = `${SYSTEM_PROMPT_HEADER}\n\nCitations to parse:\n\n${numbered}`;
  const response = await llm(prompt);
  return parseLLMResponse(response, entries);
}

/**
 * Parse the LLM's response into ParsedReference records. Tolerant of
 * code-fence wrappers (`\`\`\`json … \`\`\``) and stray prefix prose.
 *
 * Exposed for tests.
 */
export function parseLLMResponse(text: string, originals: string[]): ParsedReference[] {
  const stripped = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/```$/i, '')
    .trim();
  let parsed: unknown;
  try { parsed = JSON.parse(stripped); }
  catch (err) {
    throw new Error(
      `LLM returned non-JSON: ${err instanceof Error ? err.message : String(err)}\n${text.slice(0, 200)}`,
      { cause: err },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new Error('LLM response was not a JSON array.');
  }
  const out: ParsedReference[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const r = parsed[i] as Record<string, unknown>;
    if (!r || typeof r !== 'object') continue;
    const title = typeof r.title === 'string' ? r.title.trim() : '';
    if (!title) continue;
    out.push({
      raw: typeof r.raw === 'string' && r.raw.trim() ? r.raw : (originals[i] ?? ''),
      title,
      authors: Array.isArray(r.authors)
        ? r.authors.filter((a): a is string => typeof a === 'string' && a.trim().length > 0)
        : [],
      year: typeof r.year === 'string' && /^\d{4}$/.test(r.year) ? r.year : null,
      containerTitle: typeof r.containerTitle === 'string' && r.containerTitle.trim() ? r.containerTitle.trim() : null,
      doi: typeof r.doi === 'string' && r.doi.trim() ? r.doi.trim() : null,
      arxiv: typeof r.arxiv === 'string' && r.arxiv.trim() ? r.arxiv.trim() : null,
      pubmed: typeof r.pubmed === 'string' && r.pubmed.trim() ? r.pubmed.trim() : null,
      isbn: typeof r.isbn === 'string' && r.isbn.trim() ? r.isbn.trim() : null,
      url: typeof r.url === 'string' && r.url.trim() ? r.url.trim() : null,
      subtype: isValidSubtype(r.subtype) ? r.subtype : 'Source',
    });
  }
  return out;
}

function isValidSubtype(v: unknown): v is ParsedReference['subtype'] {
  return v === 'Article' || v === 'Book' || v === 'Preprint' || v === 'Report' || v === 'Source';
}
