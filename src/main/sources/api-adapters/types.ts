/**
 * Shared shape returned by every identifier-ingest adapter (CrossRef /
 * arXiv / PubMed). The ingest orchestrator doesn't care which adapter
 * filled in a given field — it just writes the meta.ttl and (if
 * available) pulls the open-access PDF.
 */
export interface ArticleMetadata {
  /** Human-readable source type for display; maps to a thought:* subclass. */
  subtype: 'Article' | 'Book' | 'Preprint' | 'Report' | 'Source';
  title: string;
  /** Authors in document order. */
  creators: string[];
  abstract: string | null;
  /** ISO date string (YYYY or YYYY-MM-DD) when available. */
  issued: string | null;
  publisher: string | null;
  /** Journal / book / proceedings name for articles and chapters. */
  containerTitle: string | null;
  /** Cross-identifier bits to feed `canonicalSourceId`. */
  doi: string | null;
  isbn: string | null;
  arxiv: string | null;
  pubmed: string | null;
  /** Canonical URL for the record (DOI redirect, arXiv abs page, PubMed summary). */
  uri: string | null;
  /** Fetchable open-access PDF URL if the record advertised one. */
  pdfUrl: string | null;
  /** For arXiv preprints: the subject category (`cs.AI`, `math.CO`). */
  category: string | null;
}
