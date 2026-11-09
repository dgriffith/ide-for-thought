/**
 * The whole graph's force layout (#2958): positions for every node, handed
 * back as it settles, with linked notes drawn nearer each other than unlinked.
 */
import { describe, it, expect } from 'vitest';
import { layoutGraph, ticksFor } from '../../../src/renderer/lib/graph/force-layout';

describe('layoutGraph (#2958)', () => {
  it('hands back finite positions for every node, every `every` ticks, the last marked done', () => {
    const nodes = Array.from({ length: 30 }, (_, i) => ({ id: `n${i}`, group: i < 15 ? 'a' : 'b' }));
    const edges = nodes.slice(1).map((n, i) => ({ source: nodes[i]!.id, target: n.id }));
    const calls: { length: number; done: boolean; finite: boolean }[] = [];
    layoutGraph(nodes, edges, { ticks: 100, every: 25, onPositions: (xy, done) => calls.push({ length: xy.length, done, finite: xy.every(Number.isFinite) }) });
    expect(calls.map((c) => c.done)).toEqual([false, false, false, true]);
    expect(calls.every((c) => c.length === 60 && c.finite)).toBe(true);
  });

  it('draws linked notes nearer each other than notes with nothing between them', () => {
    // Two pairs joined inside, nothing across.
    const nodes = ['a', 'b', 'c', 'd'].map((id) => ({ id, group: 'x' }));
    let xy = new Float64Array();
    layoutGraph(nodes, [{ source: 'a', target: 'b' }, { source: 'c', target: 'd' }], { ticks: 300, every: 300, onPositions: (p) => { xy = p.slice(); } });
    const dist = (i: number, j: number) => Math.hypot(xy[2 * i]! - xy[2 * j]!, xy[2 * i + 1]! - xy[2 * j + 1]!);
    expect(dist(0, 1)).toBeLessThan(dist(0, 2));
    expect(dist(2, 3)).toBeLessThan(dist(1, 3));
  });

  it('ignores an edge to a node it was not given, and a loop', () => {
    let n = 0;
    layoutGraph([{ id: 'a', group: '' }], [{ source: 'a', target: 'ghost' }, { source: 'a', target: 'a' }], { ticks: 10, every: 10, onPositions: () => { n++; } });
    expect(n).toBe(1);
  });

  it('fewer ticks for a bigger graph', () => {
    expect(ticksFor(100)).toBeGreaterThan(ticksFor(5000));
  });
});
