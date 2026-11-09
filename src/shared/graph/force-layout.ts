/**
 * The whole-thoughtbase graph's layout (#2958): a Barnes-Hut force simulation
 * (d3-force), run in a worker (`force-layout.worker.ts`) so the app stays
 * responsive, handing back positions as it settles so the graph appears at
 * once and tightens.
 *
 * Why this and not Cytoscape's `cose`: measured on generated graphs (#2958's
 * decision), `cose` grows quadratically — 1.1 s at 250 notes, 4.5 s at 500,
 * so about 450 s at the 5,000-note target — where this took 3 s at 5,000
 * notes and 15,000 edges for 150 ticks, and 0.8 s at 1,000. The drawing stays
 * Cytoscape's (in its WebGL mode for this tab), with these positions preset.
 *
 * Notes start clustered by group (their folder) on a circle, which is close to
 * where the forces would take them, so far fewer ticks are needed than from a
 * random start.
 */
import { forceCenter, forceLink, forceManyBody, forceSimulation, type SimulationNodeDatum } from 'd3-force';

export interface LayoutNode {
  id: string;
  /** Nodes of a group start together (a note's folder). */
  group: string;
  /** Pinned where the user dragged it (#2959): the forces move the rest around it. */
  fixed?: { x: number; y: number } | undefined;
}

export interface LayoutEdge {
  source: string;
  target: string;
}

export interface LayoutOptions {
  /** How many simulation steps in all. */
  ticks: number;
  /** Positions are handed back every this many ticks, and at the end. */
  every: number;
  /** Positions so far, as x/y pairs in node order; `done` on the last. */
  onPositions: (xy: Float64Array, done: boolean) => void;
  /** How far apart linked notes settle (default 40), and how hard every note
   *  pushes the rest away (default 60): a view's labelled cards (#2960) want more room than dots. */
  distance?: number;
  repulsion?: number;
}

type SimNode = SimulationNodeDatum & { id: string };

/** Where each group starts: spread on a circle sized to the graph. */
function seed(nodes: readonly LayoutNode[], spread: number): SimNode[] {
  const groups = [...new Set(nodes.map((n) => n.group))];
  const radius = Math.sqrt(nodes.length) * spread;
  const centre = new Map(groups.map((g, i) => {
    const a = (2 * Math.PI * i) / Math.max(1, groups.length);
    return [g, { x: Math.cos(a) * radius, y: Math.sin(a) * radius }] as const;
  }));
  let k = 0;
  return nodes.map((n) => {
    if (n.fixed) return { id: n.id, x: n.fixed.x, y: n.fixed.y, fx: n.fixed.x, fy: n.fixed.y };
    const c = centre.get(n.group)!;
    // A small, deterministic spiral around the group's centre, so no two start on top of each other.
    const a = k * 2.399963;
    const r = Math.sqrt(k++ % 400) * spread * 0.3;
    return { id: n.id, x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r };
  });
}

export function layoutGraph(nodes: readonly LayoutNode[], edges: readonly LayoutEdge[], opts: LayoutOptions): void {
  const sim = seed(nodes, (opts.distance ?? 40) / 2);
  const ids = new Set(nodes.map((n) => n.id));
  const links = edges.filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target).map((e) => ({ ...e }));
  const simulation = forceSimulation<SimNode>(sim)
    .force('link', forceLink<SimNode, { source: string; target: string }>(links).id((d) => d.id).distance(opts.distance ?? 40).strength(0.4))
    .force('charge', forceManyBody<SimNode>().strength(-(opts.repulsion ?? 60)).theta(0.9).distanceMax(800))
    .force('center', forceCenter(0, 0))
    .stop();
  const xy = new Float64Array(sim.length * 2);
  const emit = (done: boolean) => {
    for (let i = 0; i < sim.length; i++) { xy[2 * i] = sim[i]!.x ?? 0; xy[2 * i + 1] = sim[i]!.y ?? 0; }
    opts.onPositions(xy, done);
  };
  for (let t = 1; t <= opts.ticks; t++) {
    simulation.tick();
    if (t % opts.every === 0 && t < opts.ticks) emit(false);
  }
  emit(true);
}

/** Ticks for a graph of `n` nodes: enough to settle a small one, bounded for a large one. */
export function ticksFor(n: number): number {
  return n <= 500 ? 300 : n <= 2000 ? 200 : 150;
}
