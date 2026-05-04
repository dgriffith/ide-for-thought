/**
 * Shared helpers for the nested-tag tree (#466).
 *
 * The graph indexer stores tags as flat strings — `projects/minerva/ui`
 * is a single tag, not three nodes. The tree shape lives entirely on
 * the client; this module turns a flat `TagInfo[]` into the nested
 * structure the right-sidebar panel renders.
 *
 * Counts are cumulative — every parent reports the deduped union of
 * notes tagged at-or-under that prefix, not just notes whose literal
 * tag equals the prefix. Clicking a parent in the panel uses the
 * prefix-aware IPC and gets the same set the count promises.
 *
 * Counts here are computed from per-leaf `count` numbers as a sum,
 * which is approximate when the same note carries two tags under the
 * same prefix (e.g. `projects/minerva/ui` AND `projects/minerva/api`).
 * For an exact count, the renderer queries `notesByTagPrefix` on
 * demand. The summed count is fine as a sidebar hint.
 */

import type { TagInfo } from '../../shared/types';

export interface TagTreeNode {
  /** Last segment of the tag path, e.g. `ui` for `projects/minerva/ui`. */
  segment: string;
  /** Full path from the root, e.g. `projects/minerva/ui`. */
  path: string;
  /** Total notes with a tag at-or-under this path (sum approximation). */
  count: number;
  /** True when at least one tag in the input has exactly this path. */
  hasOwnTag: boolean;
  /** Children, sorted by segment. */
  children: TagTreeNode[];
}

/**
 * Build a tree from a flat list of tags. Nodes are sorted alphabetically
 * by segment so re-renders don't reshuffle rows.
 */
export function buildTagTree(tags: TagInfo[]): TagTreeNode[] {
  const root: TagTreeNode = { segment: '', path: '', count: 0, hasOwnTag: false, children: [] };
  for (const { tag, count } of tags) {
    if (!tag) continue;
    const parts = tag.split('/').filter(Boolean);
    let cur = root;
    let acc = '';
    for (let i = 0; i < parts.length; i++) {
      const seg = parts[i];
      acc = acc ? `${acc}/${seg}` : seg;
      let child = cur.children.find((c) => c.segment === seg);
      if (!child) {
        child = { segment: seg, path: acc, count: 0, hasOwnTag: false, children: [] };
        cur.children.push(child);
      }
      child.count += count;
      if (i === parts.length - 1) child.hasOwnTag = true;
      cur = child;
    }
  }
  // Stable sort each layer.
  const sortDeep = (n: TagTreeNode) => {
    n.children.sort((a, b) => a.segment.localeCompare(b.segment));
    for (const c of n.children) sortDeep(c);
  };
  sortDeep(root);
  return root.children;
}

/**
 * Walk the tree in display order (parent before children) and return
 * every node as a flat list. Used by the panel for the visible-row
 * list (after applying expand/search filters).
 */
export function flattenTagTree(
  nodes: TagTreeNode[],
  isExpanded: (path: string) => boolean,
  depth = 0,
): Array<TagTreeNode & { depth: number }> {
  const out: Array<TagTreeNode & { depth: number }> = [];
  for (const n of nodes) {
    out.push({ ...n, depth });
    if (n.children.length > 0 && isExpanded(n.path)) {
      out.push(...flattenTagTree(n.children, isExpanded, depth + 1));
    }
  }
  return out;
}

/**
 * True when `node` (or any descendant) has a path that includes
 * `query` as a substring. Used by the search filter — a hit anywhere
 * in the subtree keeps every ancestor visible.
 */
export function subtreeMatches(node: TagTreeNode, query: string): boolean {
  if (node.path.toLowerCase().includes(query)) return true;
  return node.children.some((c) => subtreeMatches(c, query));
}
