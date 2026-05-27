/**
 * Wire shape shared between the renderer (approval dialog) and the
 * main process (LLM mining + stub materialisation). One JS object
 * per parsed reference. (#106)
 */
export interface ParsedReference {
  raw: string;
  title: string;
  authors: string[];
  year: string | null;
  containerTitle: string | null;
  doi: string | null;
  arxiv: string | null;
  pubmed: string | null;
  isbn: string | null;
  url: string | null;
  subtype: 'Article' | 'Book' | 'Preprint' | 'Report' | 'Source';
}
