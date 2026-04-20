import path from 'node:path';

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
export const INDEXABLE_EXTS: ReadonlySet<string> = new Set(['.md', '.ttl', '.csv']);

export function isIndexable(relativePath: string): boolean {
  return INDEXABLE_EXTS.has(path.extname(relativePath).toLowerCase());
}
