import path from 'node:path';
import { THOUGHTBASE_DOC_FILENAME } from '../../shared/thoughtbase';
import { NOTE_EXTENSIONS } from '../../shared/note-extensions';

/**
 * Canonical set of file extensions that Minerva indexes + lists as
 * first-class notebase files. The sidebar filters to this set, the
 * watcher only re-indexes changes to these, and `graph.indexNote`
 * dispatches on the extension within it.
 *
 * Derived from the shared `NOTE_EXTENSIONS` (the single source of truth shared
 * with the renderer + the pure wiki-link resolver). Adding a new extension there
 * wires it through sidebar listing, watcher reindex, rename/link-rewrites, the
 * bulk index-all-notes walker, and wiki-link resolution in one place.
 */
export const INDEXABLE_EXTS: ReadonlySet<string> = new Set(NOTE_EXTENSIONS);

export function isIndexable(relativePath: string): boolean {
  // The thoughtbase guide (thoughtbase.md) is meta, not knowledge — it feeds the
  // conversation system prompt, not the graph/search. Keep it out of every index
  // (it still lists + edits like any file; listing ≠ indexing, see fs.listFiles).
  if (path.basename(relativePath) === THOUGHTBASE_DOC_FILENAME) return false;
  return INDEXABLE_EXTS.has(path.extname(relativePath).toLowerCase());
}
