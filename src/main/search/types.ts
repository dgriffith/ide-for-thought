export interface SearchResult {
  /** Relative path of the matching note */
  relativePath: string;
  /** Note title */
  title: string;
  /** Matched text with surrounding context */
  snippet: string;
  /** Relevance score (higher = better match) */
  score: number;
}

export interface SearchProvider {
  /** Add or update a document in the index */
  index(relativePath: string, title: string, content: string): void;

  /** Remove a document from the index */
  remove(relativePath: string): void;

  /** Search the index, returning ranked results */
  search(query: string, opts?: { limit?: number }): SearchResult[];

  /** Persist the index to disk */
  save(destPath: string): Promise<void>;

  /** Load a previously persisted index */
  load(srcPath: string): Promise<void>;

  /** Clear all documents from the index */
  clear(): void;
}
