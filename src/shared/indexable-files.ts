import { THOUGHTBASE_DOC_FILENAME } from './thoughtbase';
import { NOTE_EXTENSIONS } from './note-extensions';

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

/**
 * Basename and extension without `node:path` (#2238).
 *
 * This module moved from `notebase/` to `shared/` to break the
 * `graph → notebase` package edge, and `src/shared` is lint-enforced pure —
 * no Node builtins (#668), because the renderer imports from here. So the two
 * `path` calls became string work.
 *
 * They are not approximations: `tests/shared/indexable-files.test.ts` runs
 * this against `path.basename`/`path.extname` over a table of awkward inputs
 * (dotfiles, multiple dots, trailing dots, both separators, no extension) and
 * asserts they agree. Accepting `\` as a separator too is deliberate — callers
 * pass project-relative paths, and on Windows those can carry either.
 */
function basename(p: string): string {
  const cut = Math.max(p.lastIndexOf('/'), p.lastIndexOf('\\'));
  return cut === -1 ? p : p.slice(cut + 1);
}

function extname(p: string): string {
  const base = basename(p);
  const dot = base.lastIndexOf('.');
  // `path.extname` treats a LEADING dot as part of the name, not an extension
  // ('.gitignore' → ''), which `dot > 0` reproduces.
  return dot > 0 ? base.slice(dot) : '';
}

export function isIndexable(relativePath: string): boolean {
  // The thoughtbase guide (thoughtbase.md) is meta, not knowledge — it feeds the
  // conversation system prompt, not the graph/search. Keep it out of every index
  // (it still lists + edits like any file; listing ≠ indexing, see fs.listFiles).
  if (basename(relativePath) === THOUGHTBASE_DOC_FILENAME) return false;
  return INDEXABLE_EXTS.has(extname(relativePath).toLowerCase());
}
