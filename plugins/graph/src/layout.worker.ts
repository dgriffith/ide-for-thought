/**
 * The graph's layout, off the frame's thread (#2960): the same Barnes-Hut
 * force layout the thoughtbase graph uses (#2958), positions streamed back
 * as it settles.
 */
import { layoutGraph, ticksFor, type LayoutEdge, type LayoutNode } from '../../../src/shared/graph/force-layout';

export interface LayoutRequest { seq: number; nodes: LayoutNode[]; edges: LayoutEdge[] }
export interface LayoutResponse { seq: number; xy: Float64Array; done: boolean }

self.onmessage = (e: MessageEvent<LayoutRequest>) => {
  const { seq, nodes, edges } = e.data;
  layoutGraph(nodes, edges, {
    ticks: ticksFor(nodes.length),
    every: nodes.length > 2000 ? 50 : 25,
    onPositions: (xy, done) => {
      const copy = xy.slice();
      (self as unknown as Worker).postMessage({ seq, xy: copy, done } satisfies LayoutResponse, [copy.buffer]);
    },
  });
};
