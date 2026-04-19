import type { BookmarkNode } from './types';

/**
 * Apply path transitions to every bookmark in the tree. Folders recurse;
 * leaf Bookmarks have their `relativePath` updated when a transition
 * matches their current path, or when they live inside a renamed folder.
 *
 * Mutates the tree in place. Returns true if any path was changed so the
 * caller can skip the persist when nothing moved.
 */
export function applyBookmarkPathTransitions(
  tree: BookmarkNode[],
  transitions: Array<{ old: string; new: string }>,
): boolean {
  if (transitions.length === 0) return false;
  // Longer old-paths first so folder prefixes don't shadow more-specific entries.
  const sorted = [...transitions].sort((a, b) => b.old.length - a.old.length);
  let changed = false;

  const walk = (nodes: BookmarkNode[]) => {
    for (const node of nodes) {
      if (node.type === 'folder') {
        walk(node.children);
        continue;
      }
      for (const t of sorted) {
        if (node.relativePath === t.old) {
          node.relativePath = t.new;
          changed = true;
          break;
        }
        const prefix = t.old.endsWith('/') ? t.old : `${t.old}/`;
        if (node.relativePath.startsWith(prefix)) {
          node.relativePath = t.new + node.relativePath.slice(t.old.length);
          changed = true;
          break;
        }
      }
    }
  };
  walk(tree);
  return changed;
}
