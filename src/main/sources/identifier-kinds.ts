/**
 * The bibliographic identifiers a Source can be ingested from (#96, #2629):
 * one list, in detection order. Each kind recognises and normalises its own
 * spelling (a bare id or an identifier-bearing URL) and names the adapter
 * that looks it up. `ingest-identifier.ts` detects and fetches through it;
 * `ingestors.ts` registers one ingestor per kind.
 *
 * Order matters: DOI before arXiv before PubMed, so an arXiv-id-shaped string
 * isn't mis-matched as a PubMed numeric id and a DOI-shaped string wins over
 * ambiguous cases.
 */
import { normalizeDoi, normalizeArxivId, normalizePubmedId } from './source-id';
import type { ArticleMetadata } from './api-adapters/types';
import { fetchCrossrefMetadata } from './api-adapters/crossref';
import { fetchArxivMetadata } from './api-adapters/arxiv';
import { fetchPubmedMetadata } from './api-adapters/pubmed';

/** Crossref DOI shape. Used to fish a DOI out of surrounding prose. */
const DOI_IN_TEXT_RE = /\b10\.\d{4,9}\/[-._;/:a-zA-Z0-9]+/;

export interface IdentifierKindDef {
  kind: string;
  label: string;
  /** The normalised bare value when `raw` IS this kind of identifier, else null. */
  normalize: (raw: string) => string | null;
  /** The structured record for a normalised value. */
  fetchMetadata: (value: string, fetchImpl: typeof fetch) => Promise<ArticleMetadata>;
  /** An identifier of this kind found inside prose ("see 10.1145/foo for
   *  context"), for a paste that isn't one. Optional: only DOIs are
   *  distinctive enough to fish out of text. */
  findInText?: (text: string) => string | null;
}

export const IDENTIFIER_KINDS = [
  {
    kind: 'doi',
    label: 'DOI',
    normalize: normalizeDoi,
    fetchMetadata: fetchCrossrefMetadata,
    // Trim trailing punctuation the regex eats when the DOI ends a sentence.
    findInText: (text: string) => text.match(DOI_IN_TEXT_RE)?.[0].replace(/[.,;:!?)]+$/, '') ?? null,
  },
  { kind: 'arxiv', label: 'arXiv id', normalize: normalizeArxivId, fetchMetadata: fetchArxivMetadata },
  { kind: 'pubmed', label: 'PubMed id', normalize: normalizePubmedId, fetchMetadata: fetchPubmedMetadata },
] as const satisfies readonly IdentifierKindDef[];

export type IdentifierKind = (typeof IDENTIFIER_KINDS)[number]['kind'];

export function identifierKindDef(kind: IdentifierKind): IdentifierKindDef {
  return IDENTIFIER_KINDS.find((k) => k.kind === kind)!;
}
