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
