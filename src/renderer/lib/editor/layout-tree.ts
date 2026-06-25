/**
 * Recursive editor-layout tree (#813).
 *
 * The editor area is a binary tree of split nodes (each `horizontal` or
 * `vertical`) with editor-group leaves. A single open file is just a lone leaf,
 * so the no-split case is the tree `{ kind: 'leaf', groupId }`. These are pure
 * tree transforms — no Svelte, no store — so the split/collapse/rebalance logic
 * is unit-testable in isolation; the store wires them to reactive state and the
 * group lifecycle, and `SplitContainer.svelte` renders them.
 */

export type SplitDirection = 'horizontal' | 'vertical';

export interface LeafNode {
  kind: 'leaf';
  groupId: string;
}

export interface SplitNode {
  kind: 'split';
  direction: SplitDirection;
  children: LayoutNode[];
  /** Fractional sizes (sum ≈ 1), one per child, in child order. */
  sizes: number[];
}

export type LayoutNode = LeafNode | SplitNode;

export function leaf(groupId: string): LeafNode {
  return { kind: 'leaf', groupId };
}

/** Every group id referenced by the tree, in left-to-right (depth-first) order
 *  — which is also the visual order of the panes. */
export function collectGroupIds(node: LayoutNode): string[] {
  if (node.kind === 'leaf') return [node.groupId];
  return node.children.flatMap(collectGroupIds);
}

/**
 * Structural guard for an untrusted layout value (e.g. parsed from disk on
 * session restore, #816). Verifies the recursive shape — leaf/split kinds,
 * split direction, and one positive-length `sizes` entry per child — but not
 * that the leaf group ids correspond to live groups (the caller checks that).
 */
export function isLayoutNode(value: unknown): value is LayoutNode {
  if (!value || typeof value !== 'object') return false;
  const n = value as Record<string, unknown>;
  if (n.kind === 'leaf') return typeof n.groupId === 'string';
  if (n.kind === 'split') {
    return (
      (n.direction === 'horizontal' || n.direction === 'vertical') &&
      Array.isArray(n.children) &&
      n.children.length > 0 &&
      Array.isArray(n.sizes) &&
      n.sizes.length === n.children.length &&
      n.sizes.every((s) => typeof s === 'number') &&
      n.children.every(isLayoutNode)
    );
  }
  return false;
}

/** Normalize a sizes array to sum to 1 (guards against drift / bad input). */
function normalizeSizes(sizes: number[]): number[] {
  const total = sizes.reduce((a, b) => a + (b > 0 ? b : 0), 0);
  if (total <= 0) return sizes.map(() => 1 / sizes.length);
  return sizes.map((s) => (s > 0 ? s : 0) / total);
}

/**
 * Split the leaf holding `groupId` into a two-child split that adds
 * `newGroupId` alongside it.
 *
 * If the leaf's existing parent split runs in the *same* direction, the new
 * leaf is inserted as a flat sibling (keeping the tree shallow and the existing
 * panes' relative sizes intact). Otherwise the leaf is replaced by a fresh
 * binary split of the requested direction, 50/50. Returns a new tree; the
 * original is not mutated.
 */
export function splitLeaf(
  root: LayoutNode,
  groupId: string,
  direction: SplitDirection,
  newGroupId: string,
): LayoutNode {
  // Root is the target leaf → wrap it directly (no parent to flatten into).
  if (root.kind === 'leaf') {
    if (root.groupId !== groupId) return root;
    return { kind: 'split', direction, children: [leaf(groupId), leaf(newGroupId)], sizes: [0.5, 0.5] };
  }

  // Same-direction parent that directly contains the target leaf → insert a
  // flat sibling right after it, splitting the target's slice in two so the
  // other panes keep their sizes.
  if (root.direction === direction) {
    const idx = root.children.findIndex((c) => c.kind === 'leaf' && c.groupId === groupId);
    if (idx !== -1) {
      const children = [...root.children];
      const sizes = [...root.sizes];
      children.splice(idx + 1, 0, leaf(newGroupId));
      const half = sizes[idx] / 2;
      sizes.splice(idx, 1, half, half);
      return { ...root, children, sizes: normalizeSizes(sizes) };
    }
  }

  // Otherwise recurse into children, rebuilding the path to the change.
  return {
    ...root,
    children: root.children.map((c) => splitLeaf(c, groupId, direction, newGroupId)),
  };
}

/**
 * Remove the leaf holding `groupId` and rebalance: a split left with a single
 * child collapses into that child. Returns the new tree, or `null` if the leaf
 * was the entire tree (caller keeps the last pane — the window always has one).
 */
export function removeLeaf(root: LayoutNode, groupId: string): LayoutNode | null {
  if (root.kind === 'leaf') {
    return root.groupId === groupId ? null : root;
  }
  const kept: LayoutNode[] = [];
  const keptSizes: number[] = [];
  root.children.forEach((child, i) => {
    const next = removeLeaf(child, groupId);
    if (next !== null) {
      kept.push(next);
      keptSizes.push(root.sizes[i]);
    }
  });
  if (kept.length === 0) return null;
  if (kept.length === 1) return kept[0]; // collapse single-child split
  return { ...root, children: kept, sizes: normalizeSizes(keptSizes) };
}
