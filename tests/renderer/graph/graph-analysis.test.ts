/**
 * Finding your way around the graph (#2959): search, a hop radius, and the
 * shortest connection between two notes over mixed kinds — or none.
 */
import { describe, it, expect } from 'vitest';
import { matchNodes, shortestPath, withinHops } from '../../../src/renderer/lib/graph/graph-analysis';
import type { WholeGraphNode } from '../../../src/shared/types';

const node = (id: string, label = id): WholeGraphNode => ({ id, kind: 'note', label, exists: true, folder: '', type: null, tags: [] });
const edge = (source: string, target: string, linkType = 'references') => ({ source, target, linkType, linkLabel: linkType, linkColor: '#fff', direction: 'out' as const });

// a → b (link), c → b (a link property, pointing the other way), c → d (supports); e alone.
const EDGES = [edge('a', 'b'), edge('c', 'b', 'property:location'), edge('c', 'd', 'supports')];

describe('matchNodes (#2959)', () => {
  it('finds names containing the query, case-folded, in order; nothing for a blank one', () => {
    const nodes = [node('1', 'Prague Castle'), node('2', 'Plan'), node('3', 'old prague')];
    expect(matchNodes(nodes, 'PRAGUE')).toEqual(['1', '3']);
    expect(matchNodes(nodes, '  ')).toEqual([]);
  });
});

describe('withinHops (#2959)', () => {
  it('reaches either way along an edge, as far as asked', () => {
    expect([...withinHops(EDGES, 'a', 1)].sort()).toEqual(['a', 'b']);
    expect([...withinHops(EDGES, 'a', 2)].sort()).toEqual(['a', 'b', 'c']);
    expect([...withinHops(EDGES, 'a', 5)].sort()).toEqual(['a', 'b', 'c', 'd']);
    expect([...withinHops(EDGES, 'e', 3)]).toEqual(['e']);
  });
});

describe('shortestPath (#2959)', () => {
  it('connects two notes over mixed kinds, either way along each edge, listing the steps', () => {
    const p = shortestPath(EDGES, 'a', 'd')!;
    expect(p.nodes).toEqual(['a', 'b', 'c', 'd']);
    expect(p.edges.map((e) => e.linkType)).toEqual(['references', 'property:location', 'supports']);
  });

  it('takes the shortest of two routes', () => {
    const p = shortestPath([...EDGES, edge('a', 'd', 'related-to')], 'a', 'd')!;
    expect(p.nodes).toEqual(['a', 'd']);
  });

  it('is null when nothing connects them, and a single node for a note and itself', () => {
    expect(shortestPath(EDGES, 'a', 'e')).toBeNull();
    expect(shortestPath(EDGES, 'a', 'a')).toEqual({ nodes: ['a'], edges: [] });
  });
});
