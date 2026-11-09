/**
 * Finding your way around the whole graph (#2959): find notes by name, what's
 * within N steps of one, and how two are connected — all over the graph as
 * drawn (the filters already applied), so a hidden kind of connection is never
 * a step. Connections count either way: a link from A to B joins them.
 */
import type { NeighborhoodEdge, WholeGraphNode } from '../../../shared/types';

/** The nodes whose name contains `query` (case-folded), in the order given; nothing for a blank query. */
export function matchNodes(nodes: readonly WholeGraphNode[], query: string): string[] {
  const q = query.trim().toLocaleLowerCase();
  if (q === '') return [];
  return nodes.filter((n) => n.label.toLocaleLowerCase().includes(q)).map((n) => n.id);
}

function neighbours(edges: readonly NeighborhoodEdge[]): Map<string, string[]> {
  const near = new Map<string, string[]>();
  const add = (a: string, b: string) => { const l = near.get(a); if (l) l.push(b); else near.set(a, [b]); };
  for (const e of edges) { add(e.source, e.target); add(e.target, e.source); }
  return near;
}

/** Everything within `hops` steps of `from`, `from` included. */
export function withinHops(edges: readonly NeighborhoodEdge[], from: string, hops: number): Set<string> {
  const near = neighbours(edges);
  const reached = new Set([from]);
  let frontier = [from];
  for (let d = 0; d < hops && frontier.length > 0; d++) {
    const next: string[] = [];
    for (const id of frontier) for (const o of near.get(id) ?? []) if (!reached.has(o)) { reached.add(o); next.push(o); }
    frontier = next;
  }
  return reached;
}

/** One shortest connection between two nodes: the nodes along it, in order, and the edge taken at each step. */
export interface GraphPath {
  nodes: string[];
  edges: NeighborhoodEdge[];
}

/**
 * A shortest path from `a` to `b` (breadth-first, either way along an edge),
 * or null when nothing connects them. Of several equally short, the one that
 * reaches first in edge order — stable for the same graph.
 */
export function shortestPath(edges: readonly NeighborhoodEdge[], a: string, b: string): GraphPath | null {
  if (a === b) return { nodes: [a], edges: [] };
  const via = new Map<string, NeighborhoodEdge[]>();
  for (const e of edges) {
    (via.get(e.source) ?? via.set(e.source, []).get(e.source)!).push(e);
    (via.get(e.target) ?? via.set(e.target, []).get(e.target)!).push(e);
  }
  const came = new Map<string, { from: string; edge: NeighborhoodEdge }>();
  const seen = new Set([a]);
  let frontier = [a];
  while (frontier.length > 0 && !seen.has(b)) {
    const next: string[] = [];
    for (const id of frontier) {
      for (const e of via.get(id) ?? []) {
        const other = e.source === id ? e.target : e.source;
        if (seen.has(other)) continue;
        seen.add(other);
        came.set(other, { from: id, edge: e });
        next.push(other);
      }
    }
    frontier = next;
  }
  if (!seen.has(b)) return null;
  const nodes = [b];
  const steps: NeighborhoodEdge[] = [];
  for (let at = b; at !== a;) {
    const c = came.get(at)!;
    steps.unshift(c.edge);
    nodes.unshift(c.from);
    at = c.from;
  }
  return { nodes, edges: steps };
}
