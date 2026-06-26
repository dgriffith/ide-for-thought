/**
 * Link-type display filter (#848) — hide edges by type and drop nodes the hide
 * orphans from the root.
 */

import { describe, it, expect } from 'vitest';
import { filterNeighborhood } from '../../../src/renderer/lib/graph/filter-neighborhood';
import type { NeighborhoodNode, NeighborhoodEdge } from '../../../src/shared/types';

const n = (id: string): NeighborhoodNode => ({ id, kind: 'note', label: id, exists: true });
const e = (source: string, target: string, linkType: string): NeighborhoodEdge => ({
  source, target, linkType, linkLabel: linkType, linkColor: '#fff', direction: 'out',
});

describe('filterNeighborhood', () => {
  const nodes = [n('root'), n('a'), n('b'), n('c')];
  // root —references→ a, root —rebuts→ b, b —references→ c
  const edges = [e('root', 'a', 'references'), e('root', 'b', 'rebuts'), e('b', 'c', 'references')];

  it('returns the whole graph when nothing is hidden', () => {
    const f = filterNeighborhood(nodes, edges, 'root', new Set());
    expect(f.nodes.map((x) => x.id).sort()).toEqual(['a', 'b', 'c', 'root']);
    expect(f.edges).toHaveLength(3);
  });

  it('hides edges of a hidden type', () => {
    const f = filterNeighborhood(nodes, edges, 'root', new Set(['references']));
    expect(f.edges.every((x) => x.linkType !== 'references')).toBe(true);
  });

  it('drops nodes orphaned from the root by a hidden type', () => {
    // Hiding "rebuts" cuts root→b; b and (its child) c both fall away.
    const f = filterNeighborhood(nodes, edges, 'root', new Set(['rebuts']));
    expect(f.nodes.map((x) => x.id).sort()).toEqual(['a', 'root']);
    expect(f.edges).toHaveLength(1);
  });

  it('keeps a node still reachable via another edge type', () => {
    // a is reachable from root via references AND (add) via depends-on; hiding one keeps it.
    const ns = [n('root'), n('a')];
    const es = [e('root', 'a', 'references'), e('root', 'a', 'depends-on')];
    const f = filterNeighborhood(ns, es, 'root', new Set(['references']));
    expect(f.nodes.map((x) => x.id).sort()).toEqual(['a', 'root']);
    expect(f.edges).toHaveLength(1);
  });

  it('always keeps the root, even when fully isolated', () => {
    const f = filterNeighborhood(nodes, edges, 'root', new Set(['references', 'rebuts']));
    expect(f.nodes.map((x) => x.id)).toEqual(['root']);
    expect(f.edges).toEqual([]);
  });

  it('treats edges as undirected for reachability (backlink in)', () => {
    // inbound —references→ root ; root still reaches inbound.
    const ns = [n('root'), n('inbound')];
    const es = [e('inbound', 'root', 'references')];
    const f = filterNeighborhood(ns, es, 'root', new Set());
    expect(f.nodes.map((x) => x.id).sort()).toEqual(['inbound', 'root']);
  });
});
