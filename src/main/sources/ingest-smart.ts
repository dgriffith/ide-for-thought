/**
 * Smart-route ingest (#473). Given a raw string from a clipboard paste or the
 * Sources panel's "+" button, pick the right ingest path:
 *
 *   1. Bare DOI / DOI URL / arXiv id / PMID → identifier flow (CrossRef /
 *      arXiv / PubMed adapter).
 *   2. Any other http(s) URL → URL flow (Readability, plus the per-site
 *      handlers — an arXiv or PubMed page URL is read there).
 *   3. Free text with an embedded DOI → extract + identifier flow
 *      (so a copy-paste of "see 10.1145/foo for context" still works).
 *
 * The routing is the ingestor registry's (`ingestors.ts`, #2629); this is the
 * text-input wrapper over `ingestSource`.
 */

import { ingestSource, type IngestOptions, type IngestOutcome } from './ingestors';

export type SmartIngestResult = Extract<IngestOutcome, { route: 'identifier' | 'url' }>;
export type SmartIngestOptions = IngestOptions;

export async function ingestSmart(
  rootPath: string,
  rawInput: string,
  opts: SmartIngestOptions = {},
): Promise<SmartIngestResult> {
  // Text never routes to a file ingestor.
  return await ingestSource(rootPath, { kind: 'text', text: rawInput }, opts) as SmartIngestResult;
}
