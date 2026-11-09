/**
 * The whole-thoughtbase graph's layout time (#2958): `layoutGraph` (d3-force,
 * Barnes-Hut) at 1,000 and 5,000 notes, about three edges each, mostly within
 * folders of fifty — the shape of a thoughtbase. The 5,000-note case is the
 * epic's target; it runs in a worker in the app, so this measures how long the
 * graph takes to settle, not how long the app is blocked.
 *
 * New, so not yet in the baseline: bless it on CI (Bench workflow,
 * `update_baseline: true`), never locally (#2211).
 */
import { describe, test } from 'vitest';
import { layoutGraph, ticksFor, type LayoutEdge, type LayoutNode } from '../../../src/shared/graph/force-layout';
import { assertFixtureReaches } from '../../helpers/bench-fixture';

function generated(n: number): { nodes: LayoutNode[]; edges: LayoutEdge[] } {
  let seed = 7;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const nodes = Array.from({ length: n }, (_, i) => ({ id: `n${i}`, group: `folder-${Math.floor(i / 50)}` }));
  const edges: LayoutEdge[] = [];
  for (let k = 0; k < n * 3; k++) {
    const a = Math.floor(rnd() * n);
    const b = rnd() < 0.8 ? (Math.floor(a / 50) * 50 + Math.floor(rnd() * 50)) % n : Math.floor(rnd() * n);
    if (a !== b) edges.push({ source: `n${a}`, target: `n${b}` });
  }
  return { nodes, edges };
}

for (const n of [1000, 5000]) {
  const g = generated(n);
  // The fixture is the epic's target shape (#2958): about three links a note, mostly within a folder,
  // so the layout runs the link force at scale and the folder-clustered start has something to cluster.
  const inFolder = g.edges.filter((e) => g.nodes[Number(e.source.slice(1))]!.group === g.nodes[Number(e.target.slice(1))]!.group).length;
  assertFixtureReaches(`${n} notes carry close to ${n * 3} links`, g.edges.length >= n * 2.9, g.edges.length);
  assertFixtureReaches('most links stay within a folder', inFolder / g.edges.length > 0.7, inFolder / g.edges.length);
  describe(`graph layout — ${n} notes`, () => {
    test(`layoutGraph: ${n} notes / ${n * 3} edges, settled`, async ({ bench }) => {
      // Ten samples, not the default 64: one settle at 5,000 notes takes seconds, and the
      // point is the scale envelope (#2958), not a sub-millisecond mean.
      await bench(`layoutGraph: ${n} notes / ${n * 3} edges, settled`, () => {
        layoutGraph(g.nodes, g.edges, { ticks: ticksFor(n), every: ticksFor(n), onPositions: () => {} });
      }).run({ iterations: 10, time: 0 });
    });
  });
}
