/**
 * Identifier-based ingestion (#96).
 *
 * Accepts a DOI, arXiv id, or PubMed id, looks it up against the
 * appropriate bibliographic API, writes a fully-populated Source under
 * `.minerva/sources/<id>/`, and (when the record advertises one) fetches
 * the open-access PDF alongside.
 *
 * Unlike `ingestUrl`, the metadata comes from a structured record —
 * titles / authors / journals / abstracts arrive correctly, no Readability
 * heuristics involved. This is the researcher's path.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { canonicalSourceId, normalizeDoi, normalizeArxivId, normalizePubmedId } from './source-id';
import type { ArticleMetadata } from './api-adapters/types';
import { fetchCrossrefMetadata } from './api-adapters/crossref';
import { fetchArxivMetadata } from './api-adapters/arxiv';
import { fetchPubmedMetadata } from './api-adapters/pubmed';

export type IdentifierKind = 'doi' | 'arxiv' | 'pubmed';

export interface DetectedIdentifier {
  kind: IdentifierKind;
  /** Normalised bare value suitable for the API and for canonical-id use. */
  value: string;
}

export interface IdentifierIngestResult {
  sourceId: string;
  relativePath: string;
  duplicate: boolean;
  title: string;
  /** Which identifier kind we matched. */
  kind: IdentifierKind;
  /** True when an open-access PDF was successfully fetched and saved. */
  pdfSaved: boolean;
  /** Populated when the PDF was advertised but the fetch failed, for UI messaging. */
  pdfError: string | null;
}

export interface IdentifierIngestOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Detect which kind of identifier the user typed. Order matters: DOI
 * before arXiv before PubMed, so an arXiv-id-shaped string doesn't get
 * mis-matched as a PubMed numeric id and so a DOI-shaped string wins over
 * ambiguous cases.
 */
export function detectIdentifier(raw: string): DetectedIdentifier | null {
  const doi = normalizeDoi(raw);
  if (doi) return { kind: 'doi', value: doi };
  const arxiv = normalizeArxivId(raw);
  if (arxiv) return { kind: 'arxiv', value: arxiv };
  const pubmed = normalizePubmedId(raw);
  if (pubmed) return { kind: 'pubmed', value: pubmed };
  return null;
}

export async function ingestIdentifier(
  rootPath: string,
  rawInput: string,
  opts: IdentifierIngestOptions = {},
): Promise<IdentifierIngestResult> {
  const identifier = detectIdentifier(rawInput);
  if (!identifier) {
    throw new Error(`Not a recognised DOI / arXiv id / PubMed id: ${rawInput}`);
  }
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;

  const metadata = await fetchMetadataFor(identifier, fetchImpl);

  // Compute the canonical id from every identifier we've now got — we may
  // have started with an arXiv id and come back with a DOI cross-reference,
  // which gives a better primary id.
  const { id: sourceId } = canonicalSourceId({
    doi: metadata.doi ?? undefined,
    arxiv: metadata.arxiv ?? undefined,
    pubmed: metadata.pubmed ?? undefined,
    isbn: metadata.isbn ?? undefined,
    url: metadata.uri ?? undefined,
  });
  const sourceDir = path.join(rootPath, '.minerva', 'sources', sourceId);
  const relativePath = `.minerva/sources/${sourceId}/meta.ttl`;

  // Dedupe: existing meta.ttl → bail without overwriting.
  try {
    await fs.access(path.join(sourceDir, 'meta.ttl'));
    return {
      sourceId,
      relativePath,
      duplicate: true,
      title: metadata.title,
      kind: identifier.kind,
      pdfSaved: false,
      pdfError: null,
    };
  } catch { /* not found — proceed */ }

  await fs.mkdir(sourceDir, { recursive: true });
  await fs.writeFile(path.join(sourceDir, 'meta.ttl'), buildMetaTtl(metadata), 'utf-8');

  // When the record has an abstract, seed body.md with it. Readers can
  // replace it later if they add the paper text by hand or via #94.
  if (metadata.abstract) {
    await fs.writeFile(
      path.join(sourceDir, 'body.md'),
      `# ${metadata.title}\n\n${metadata.abstract}\n`,
      'utf-8',
    );
  }

  let pdfSaved = false;
  let pdfError: string | null = null;
  if (metadata.pdfUrl) {
    try {
      const buf = await fetchPdfBytes(metadata.pdfUrl, fetchImpl);
      await fs.writeFile(path.join(sourceDir, 'original.pdf'), buf);
      pdfSaved = true;
    } catch (err) {
      pdfError = err instanceof Error ? err.message : String(err);
    }
  }

  return {
    sourceId,
    relativePath,
    duplicate: false,
    title: metadata.title,
    kind: identifier.kind,
    pdfSaved,
    pdfError,
  };
}

async function fetchMetadataFor(
  identifier: DetectedIdentifier,
  fetchImpl: typeof fetch,
): Promise<ArticleMetadata> {
  switch (identifier.kind) {
    case 'doi': return fetchCrossrefMetadata(identifier.value, fetchImpl);
    case 'arxiv': return fetchArxivMetadata(identifier.value, fetchImpl);
    case 'pubmed': return fetchPubmedMetadata(identifier.value, fetchImpl);
  }
}

async function fetchPdfBytes(url: string, fetchImpl: typeof fetch): Promise<Uint8Array> {
  const res = await fetchImpl(url, {
    headers: {
      'Accept': 'application/pdf,*/*;q=0.8',
      // Some publishers gate PDF access on a browser-shaped UA.
      'User-Agent': 'Mozilla/5.0 Minerva/1.0',
    },
    redirect: 'follow',
  });
  if (!res.ok) throw new Error(`PDF fetch ${res.status}: ${res.statusText}`);
  const ct = (res.headers.get('content-type') ?? '').toLowerCase();
  // Publishers sometimes 200 with an HTML paywall/interstitial. Refuse
  // anything that doesn't look like PDF bytes — the user can fetch the
  // PDF manually later with the advertised URL saved in meta.ttl.
  if (!ct.includes('pdf') && ct.length > 0) {
    throw new Error(`PDF endpoint returned ${ct} instead of a PDF`);
  }
  const ab = await res.arrayBuffer();
  return new Uint8Array(ab);
}

/**
 * Emit the Turtle metadata file. Mirrors `ingest.ts`'s shape but handles
 * the richer field set identifier-ingest returns (multi-author
 * `dc:creator`, container titles for journal articles, ISBN / arXiv id /
 * PubMed id cross-references where present).
 */
export function buildMetaTtl(metadata: ArticleMetadata): string {
  const lines: string[] = [
    `this: a thought:${metadata.subtype} ;`,
    `    dc:title ${ttlString(metadata.title)} ;`,
  ];
  for (const creator of metadata.creators) {
    lines.push(`    dc:creator ${ttlString(creator)} ;`);
  }
  if (metadata.issued) {
    const iso = metadata.issued;
    if (/^\d{4}$/.test(iso)) lines.push(`    dc:issued ${ttlString(iso)}^^xsd:gYear ;`);
    else if (/^\d{4}-\d{2}$/.test(iso)) lines.push(`    dc:issued ${ttlString(iso)}^^xsd:gYearMonth ;`);
    else if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) lines.push(`    dc:issued ${ttlString(iso)}^^xsd:date ;`);
    else lines.push(`    dc:issued ${ttlString(iso)} ;`);
  }
  if (metadata.publisher) lines.push(`    dc:publisher ${ttlString(metadata.publisher)} ;`);
  if (metadata.containerTitle) lines.push(`    schema:inContainer ${ttlString(metadata.containerTitle)} ;`);
  if (metadata.doi) lines.push(`    bibo:doi ${ttlString(metadata.doi)} ;`);
  if (metadata.isbn) lines.push(`    bibo:isbn ${ttlString(metadata.isbn)} ;`);
  if (metadata.uri) lines.push(`    bibo:uri ${ttlString(metadata.uri)} ;`);
  if (metadata.abstract) lines.push(`    dc:abstract ${ttlString(metadata.abstract)} ;`);
  lines.push(`    thought:accessedAt ${ttlString(new Date().toISOString())}^^xsd:dateTime .`);
  return lines.join('\n') + '\n';
}

function ttlString(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}
