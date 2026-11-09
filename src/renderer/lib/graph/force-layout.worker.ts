/// <reference lib="webworker" />
/**
 * The whole-thoughtbase graph's layout, off the UI thread (#2958): runs
 * `layoutGraph` (d3-force) and posts positions as the simulation settles, so
 * the graph tab draws at once and stays responsive at thousands of notes.
 *
 * One request at a time per worker: a new request (the filters changed) is
 * answered after the one in progress; the caller ignores a stale `seq`.
 */
import { layoutGraph, ticksFor, type LayoutEdge, type LayoutNode } from '../../../shared/graph/force-layout';

export interface LayoutRequest {
  seq: number;
  nodes: LayoutNode[];
  edges: LayoutEdge[];
}

export interface LayoutResponse {
  seq: number;
  /** x/y pairs in the request's node order. */
  xy: Float64Array;
  done: boolean;
}

self.onmessage = (e: MessageEvent<LayoutRequest>) => {
  const { seq, nodes, edges } = e.data;
  layoutGraph(nodes, edges, {
    ticks: ticksFor(nodes.length),
    // Each update repositions every node on the canvas: a big graph is sent half as often (#2958).
    every: nodes.length > 2000 ? 50 : 25,
    onPositions: (xy, done) => {
      const copy = xy.slice();
      (self as unknown as DedicatedWorkerGlobalScope).postMessage({ seq, xy: copy, done } satisfies LayoutResponse, [copy.buffer]);
    },
  });
};
