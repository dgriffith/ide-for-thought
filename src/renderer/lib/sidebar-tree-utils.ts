/**
 * Helpers for the sidebar's multi-selection model.
 *
 * `flattenVisible` walks the tree in display order, returning every
 * row that's currently visible (a directory is always visible; its
 * children only when `expanded[dir.relativePath]` is true). Used by
 * shift-click range-selection and ⌘A.
 *
 * `expandSelectionToFiles` takes a selection (which can include
 * directories) and produces the set of leaf .md files that fall under
 * any selected entry. The action layer (Format, Delete-many, …) uses
 * this to resolve "what does the user actually want to act on?".
 */

import type { NoteFile } from '../../shared/types';

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
 * of note files (.md) underneath it. Directories contribute every .md
 * descendant; explicit file selections pass through if they end in .md.
 */
export function expandSelectionToNoteFiles(
  selection: ReadonlySet<string>,
  tree: NoteFile[],
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

  const collectMd = (node: NoteFile) => {
    if (!node.isDirectory) {
      if (node.relativePath.endsWith('.md')) found.add(node.relativePath);
      return;
    }
    if (node.children) {
      for (const c of node.children) collectMd(c);
    }
  };

  for (const path of selection) {
    const node = byPath.get(path);
    if (node) collectMd(node);
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
