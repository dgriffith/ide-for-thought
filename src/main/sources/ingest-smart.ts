/**
 * Smart-route ingest (#473). Given a raw string from a clipboard
 * paste or the Sources panel's "+" button, pick the right ingest
 * path:
 *
 *   1. Bare DOI / DOI URL / arXiv id / arXiv URL / PMID / PubMed URL
 *      → identifier flow (CrossRef / arXiv / PubMed adapter).
 *   2. Bare URL (http/https) → URL flow (Readability extraction).
 *   3. Free text with an embedded DOI → extract + identifier flow
 *      (so a copy-paste of "see 10.1145/foo for context" still
 *      works).
 *
 * Returns the same shape as `ingestUrl` / `ingestIdentifier` so the
 * UI can open the resulting source uniformly.
 */

import { ingestIdentifier, detectIdentifier, type IdentifierIngestResult } from './ingest-identifier';
import { ingestUrl, type IngestResult } from './ingest';

export type SmartIngestResult =
  | (IdentifierIngestResult & { route: 'identifier' })
  | (IngestResult & { route: 'url' });

export interface SmartIngestOptions {
  fetchImpl?: typeof fetch;
  importUpstreamTags?: boolean;
}

/** Crossref DOI shape. Used to fish a DOI out of surrounding prose. */
const DOI_IN_TEXT_RE = /\b10\.\d{4,9}\/[-._;/:a-zA-Z0-9]+/;

export async function ingestSmart(
  rootPath: string,
  rawInput: string,
  opts: SmartIngestOptions = {},
): Promise<SmartIngestResult> {
  const input = rawInput.trim();
  if (!input) throw new Error('Empty input.');

  // 1. If the whole string is a recognized identifier (or an
  //    identifier-bearing URL — detectIdentifier handles arXiv/PubMed
  //    URLs via normalizeArxivId/normalizePubmedId), prefer that.
  if (detectIdentifier(input)) {
    const r = await ingestIdentifier(rootPath, input, opts);
    return { ...r, route: 'identifier' };
  }

  // 2. URL — Readability ingest.
  if (/^https?:\/\//i.test(input)) {
    const r = await ingestUrl(rootPath, input, opts);
    return { ...r, route: 'url' };
  }

  // 3. Free text with an embedded DOI — extract the first DOI we
  //    see and feed it through the identifier path.
  const m = input.match(DOI_IN_TEXT_RE);
  if (m) {
    // Trim trailing punctuation the regex might have eaten when the
    // DOI sat at end-of-sentence.
    const doi = m[0].replace(/[.,;:!?)]+$/, '');
    const r = await ingestIdentifier(rootPath, doi, opts);
    return { ...r, route: 'identifier' };
  }

  throw new Error(`Not a recognised URL, DOI, arXiv id, or PubMed id: ${rawInput}`);
}
