/**
 * Helpers for the sidebar's multi-selection model.
 *
 * `flattenVisible` walks the tree in display order, returning every
 * row that's currently visible (a directory is always visible; its
 * children only when `expanded[dir.relativePath]` is true). Used by
 * shift-click range-selection and ⌘A.
 *
 * `expandSelectionToNoteFiles` / `expandSelectionToNotes` take a selection
 * (which can include directories) and produce the leaf files under any
 * selected entry — markdown only, or every first-class note format
 * respectively. The action layer (Format, Delete-many, Label Version, …) uses
 * these to resolve "what does the user actually want to act on?".
 */

import type { NoteFile } from '../../shared/types';
import { isNotePath } from '../../shared/note-extensions';

export function flattenVisible(
  tree: NoteFile[],
  expanded: Record<string, boolean>,
): string[] {
  const out: string[] = [];
  const walk = (nodes: NoteFile[]) => {
    for (const n of nodes) {
      out.push(n.relativePath);
      if (n.isDirectory && n.children && expanded[n.relativePath]) {
        walk(n.children);
      }
    }
  };
  walk(tree);
  return out;
}

/**
 * Resolve a selection set (paths of files OR directories) to the set
 * of markdown files underneath it. Directories contribute every .md
 * descendant; explicit file selections pass through if they end in .md.
 *
 * Markdown-only on purpose: its callers edit frontmatter (tags, properties,
 * format), which only markdown has. Operations that act on a note as a *file*
 * — version labeling — want `expandSelectionToNotes` instead, which covers
 * every first-class note format.
 */
export function expandSelectionToNoteFiles(
  selection: ReadonlySet<string>,
  tree: NoteFile[],
): string[] {
  return expandSelection(selection, tree, (p) => p.endsWith('.md'));
}

/**
 * Same walk, but over every first-class note format (.md/.ttl/.csv/.py — see
 * `shared/note-extensions`). Use this for operations that treat a note as a
 * file rather than as markdown; a folder of .csv notes is a real selection,
 * not an empty one.
 */
export function expandSelectionToNotes(
  selection: ReadonlySet<string>,
  tree: NoteFile[],
): string[] {
  return expandSelection(selection, tree, isNotePath);
}

function expandSelection(
  selection: ReadonlySet<string>,
  tree: NoteFile[],
  matches: (relativePath: string) => boolean,
): string[] {
  const found = new Set<string>();
  // Build a path → node lookup by walking the tree once. Cheaper than
  // re-traversing for each selected path.
  const byPath = new Map<string, NoteFile>();
  const walk = (nodes: NoteFile[]) => {
    for (const n of nodes) {
      byPath.set(n.relativePath, n);
      if (n.children) walk(n.children);
    }
  };
  walk(tree);

  const collect = (node: NoteFile) => {
    if (!node.isDirectory) {
      if (matches(node.relativePath)) found.add(node.relativePath);
      return;
    }
    if (node.children) {
      for (const c of node.children) collect(c);
    }
  };

  for (const path of selection) {
    const node = byPath.get(path);
    if (node) collect(node);
  }
  return [...found];
}

/**
 * Resolve a sidebar selection to a list of action targets — distinct
 * from `expandSelectionToNoteFiles` because Delete / Cut / Copy /
 * drag-Move all operate on whatever the user chose (folders stay
 * folders, non-md files stay), not just the .md descendants.
 *
 * Two rules:
 *   1. Drop paths whose ancestor directory is also selected — acting
 *      on a folder already covers its contents, so listing both is
 *      wasted work (and may surface a confusing post-action error if
 *      the child is gone / already moved by the time we get to it).
 *   2. Drop paths missing from the tree (stale selection from a
 *      concurrent file-system change).
 */
export function resolveSelectionTargets(
  selection: ReadonlySet<string>,
  tree: NoteFile[],
): Array<{ relativePath: string; isDirectory: boolean }> {
  const byPath = new Map<string, NoteFile>();
  const walk = (nodes: NoteFile[]) => {
    for (const n of nodes) {
      byPath.set(n.relativePath, n);
      if (n.children) walk(n.children);
    }
  };
  walk(tree);

  const selectedDirs: string[] = [];
  for (const p of selection) {
    if (byPath.get(p)?.isDirectory) selectedDirs.push(p);
  }

  const out: Array<{ relativePath: string; isDirectory: boolean }> = [];
  for (const p of selection) {
    const node = byPath.get(p);
    if (!node) continue;
    const coveredByAncestor = selectedDirs.some(
      (d) => d !== p && p.startsWith(d + '/'),
    );
    if (coveredByAncestor) continue;
    out.push({ relativePath: node.relativePath, isDirectory: !!node.isDirectory });
  }
  return out;
}

/**
 * True iff `path` (file OR directory) appears anywhere in `tree`. Used
 * for paste/move collision detection — `api.notebase.readFile` only
 * works for files, so a folder collision would slip through if we
 * relied on that.
 */
export function pathExistsInTree(path: string, tree: NoteFile[]): boolean {
  const stack: NoteFile[] = [...tree];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node.relativePath === path) return true;
    if (node.children) stack.push(...node.children);
  }
  return false;
}
