import path from 'node:path';
import { THOUGHTBASE_DOC_FILENAME } from '../../shared/thoughtbase';

/**
 * Canonical set of file extensions that Minerva indexes + lists as
 * first-class notebase files. The sidebar filters to this set, the
 * watcher only re-indexes changes to these, and `graph.indexNote`
 * dispatches on the extension within it.
 *
 * Adding a new extension here is the single change needed to wire it
 * through sidebar listing, watcher reindex, rename/link-rewrites, and
 * the bulk index-all-notes walker.
 */
export const INDEXABLE_EXTS: ReadonlySet<string> = new Set(['.md', '.ttl', '.csv', '.py']);

export function isIndexable(relativePath: string): boolean {
  // The thoughtbase guide (thoughtbase.md) is meta, not knowledge — it feeds the
  // conversation system prompt, not the graph/search. Keep it out of every index
  // (it still lists + edits like any file; listing ≠ indexing, see fs.listFiles).
  if (path.basename(relativePath) === THOUGHTBASE_DOC_FILENAME) return false;
  return INDEXABLE_EXTS.has(path.extname(relativePath).toLowerCase());
}
