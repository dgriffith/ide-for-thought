/**
 * Link-type display filter for View B (#848).
 *
 * Purely a display pass over the already-fetched neighborhood (#846) — no
 * re-traversal. Drops edges whose link type the user hid, then drops any node
 * left unreachable from the root by the surviving (undirected) edges, so hiding
 * a type never leaves orphan nodes floating. The root is always kept.
 */

import type { NeighborhoodNode, NeighborhoodEdge } from '../../../shared/types';

export interface FilteredGraph {
  nodes: NeighborhoodNode[];
  edges: NeighborhoodEdge[];
}

export function filterNeighborhood(
  nodes: NeighborhoodNode[],
  edges: NeighborhoodEdge[],
  rootId: string,
  hiddenTypes: ReadonlySet<string>,
): FilteredGraph {
  const present = new Set(nodes.map((n) => n.id));
  // Edges that survive: both endpoints present, type not hidden.
  const visible = edges.filter(
    (e) => present.has(e.source) && present.has(e.target) && !hiddenTypes.has(e.linkType),
  );

  // Undirected reachability from the root over the surviving edges.
  const adj = new Map<string, string[]>();
  const link = (a: string, b: string) => {
    const list = adj.get(a);
    if (list) list.push(b); else adj.set(a, [b]);
  };
  for (const e of visible) { link(e.source, e.target); link(e.target, e.source); }

  const reachable = new Set<string>([rootId]);
  const queue: string[] = [rootId];
  while (queue.length > 0) {
    const id = queue.shift() as string;
    for (const n of adj.get(id) ?? []) {
      if (!reachable.has(n)) { reachable.add(n); queue.push(n); }
    }
  }

  return {
    nodes: nodes.filter((n) => reachable.has(n.id)),
    edges: visible.filter((e) => reachable.has(e.source) && reachable.has(e.target)),
  };
}
