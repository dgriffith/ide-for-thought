/**
 * A mindmap's layout (#2964): any tree, laid out as a tidy tree — left to
 * right, or radial around the root — with each node sized to its label
 * (wrapped to a maximum width), folded nodes' subtrees left out, and curved
 * connectors. Pure: the renderer draws what this returns, and an export can
 * draw the same.
 *
 * The tidy tree is d3-hierarchy's Reingold–Tilford (`tree()`), given each
 * node's real height as the separation between neighbours, so no two boxes
 * overlap however tall their wrapped labels are; columns are as wide as the
 * widest label at that depth.
 */
import { hierarchy, tree, type HierarchyPointNode } from 'd3-hierarchy';

export interface MindmapTree {
  id: string;
  label: string;
  children: MindmapTree[];
}

export type MindmapOrientation = 'ltr' | 'radial';

export interface MindmapLayoutOptions {
  orientation: MindmapOrientation;
  /** Nodes whose subtrees are hidden. */
  folded?: ReadonlySet<string>;
  /** A label's width in pixels (the renderer measures; the default estimates). */
  measure?: (text: string) => number;
  /** Labels wrap past this width. */
  maxLabelWidth?: number;
}

export interface MindmapLayoutNode {
  id: string;
  label: string;
  /** The label, wrapped. */
  lines: string[];
  depth: number;
  /** Centre. */
  x: number;
  y: number;
  width: number;
  height: number;
  parent: string | null;
  /** Its children, as drawn (none when folded). */
  children: string[];
  /** It has children, drawn or not. */
  hasChildren: boolean;
  folded: boolean;
  /** How many nodes its fold hides. */
  hiddenCount: number;
}

export interface MindmapLayoutLink {
  source: string;
  target: string;
  /** An SVG path, a curve from the parent's edge to the child's. */
  path: string;
}

export interface MindmapLayout {
  nodes: MindmapLayoutNode[];
  links: MindmapLayoutLink[];
  /** The drawing's extent. */
  bounds: { x1: number; y1: number; x2: number; y2: number };
}

export const LINE_HEIGHT = 18;
const PAD_X = 10;
const PAD_Y = 6;
const GAP_Y = 10;
const GAP_X = 48;
const RING = 60;

const estimate = (text: string) => text.length * 7;

/** `text` in lines no wider than `max` (a word longer than that gets a line of its own). */
export function wrapLabel(text: string, max: number, measure: (t: string) => number): string[] {
  const words = text.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [''];
  const lines: string[] = [];
  let line = '';
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (line && measure(next) > max) { lines.push(line); line = w; } else line = next;
  }
  lines.push(line);
  return lines;
}

const count = (t: MindmapTree): number => t.children.reduce((n, c) => n + 1 + count(c), 0);

export function layoutMindmap(root: MindmapTree, opts: MindmapLayoutOptions): MindmapLayout {
  const measure = opts.measure ?? estimate;
  const max = opts.maxLabelWidth ?? 220;
  const folded = opts.folded ?? new Set<string>();
  // Folded subtrees are left out of the layout entirely.
  const h = hierarchy(root, (d) => (folded.has(d.id) ? null : d.children));
  const size = new Map<MindmapTree, { lines: string[]; w: number; h: number }>();
  h.each((n) => {
    const lines = wrapLabel(n.data.label, max, measure);
    const w = Math.max(...lines.map(measure)) + PAD_X * 2 + (n.data.children.length > 0 && folded.has(n.data.id) ? 26 : 0);
    size.set(n.data, { lines, w, h: lines.length * LINE_HEIGHT + PAD_Y * 2 });
  });
  const sz = (n: { data: MindmapTree }) => size.get(n.data)!;

  let placed: HierarchyPointNode<MindmapTree>;
  const pos = new Map<MindmapTree, { x: number; y: number }>();
  if (opts.orientation === 'ltr') {
    // Rows by height (the separation is the real distance), columns by the widest label at each depth.
    placed = tree<MindmapTree>().nodeSize([1, 1]).separation((a, b) => sz(a).h / 2 + sz(b).h / 2 + GAP_Y + (a.parent === b.parent ? 0 : GAP_Y))(h);
    const widest: number[] = [];
    placed.each((n) => { widest[n.depth] = Math.max(widest[n.depth] ?? 0, sz(n).w); });
    const colX: number[] = [0];
    for (let d = 1; d < widest.length; d++) colX[d] = colX[d - 1]! + widest[d - 1]! / 2 + GAP_X + widest[d]! / 2;
    placed.each((n) => pos.set(n.data, { x: colX[n.depth]!, y: n.x }));
  } else {
    // Angles by the tidy tree over the circle; then each ring far enough out that neighbours on it
    // don't overlap (the arc between two adjacent nodes at least their half-sizes and a gap), and
    // far enough beyond the ring inside it for the widest labels on both.
    placed = tree<MindmapTree>().size([2 * Math.PI, 1]).separation((a, b) => (a.parent === b.parent ? 1 : 2) / Math.max(1, a.depth))(h);
    const byDepth: HierarchyPointNode<MindmapTree>[][] = [];
    placed.each((n) => { (byDepth[n.depth] ??= []).push(n); });
    const radius: number[] = [0];
    for (let d = 1; d < byDepth.length; d++) {
      const ring = [...byDepth[d]!].sort((a, b) => a.x - b.x);
      const span = (n: HierarchyPointNode<MindmapTree>) => Math.max(sz(n).w, sz(n).h);
      let need = 0;
      for (let i = 0; i < ring.length && ring.length > 1; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const angle = i === ring.length - 1 ? b.x + 2 * Math.PI - a.x : b.x - a.x;
        if (angle > 1e-9) need = Math.max(need, (span(a) / 2 + span(b) / 2 + GAP_Y) / angle);
      }
      const widestIn = Math.max(...byDepth[d - 1]!.map((n) => sz(n).w));
      const widestOut = Math.max(...ring.map((n) => sz(n).w));
      radius[d] = Math.max(need, radius[d - 1]! + Math.max(RING, (widestIn + widestOut) / 2 + GAP_X / 2));
    }
    placed.each((n) => {
      const r = radius[n.depth]!;
      pos.set(n.data, { x: r * Math.cos(n.x - Math.PI / 2), y: r * Math.sin(n.x - Math.PI / 2) });
    });
  }

  const nodes: MindmapLayoutNode[] = [];
  const links: MindmapLayoutLink[] = [];
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  // Depth first, each node then its children: the order a screen reader reads the drawn tree in.
  placed.eachBefore((n) => {
    const p = pos.get(n.data)!;
    const s = sz(n);
    const isFolded = folded.has(n.data.id) && n.data.children.length > 0;
    nodes.push({
      id: n.data.id, label: n.data.label, lines: s.lines, depth: n.depth, x: p.x, y: p.y, width: s.w, height: s.h,
      parent: n.parent?.data.id ?? null, children: (n.children ?? []).map((c) => c.data.id),
      hasChildren: n.data.children.length > 0, folded: isFolded, hiddenCount: isFolded ? count(n.data) : 0,
    });
    x1 = Math.min(x1, p.x - s.w / 2); x2 = Math.max(x2, p.x + s.w / 2);
    y1 = Math.min(y1, p.y - s.h / 2); y2 = Math.max(y2, p.y + s.h / 2);
    if (n.parent) {
      const q = pos.get(n.parent.data)!;
      const ps = sz(n.parent);
      links.push({ source: n.parent.data.id, target: n.data.id, path: curve(q, ps, p, s, opts.orientation) });
    }
  });
  return { nodes, links, bounds: { x1, y1, x2, y2 } };
}

/** A curve from the parent's edge to the child's: horizontal tangents left to right, along the radius when radial. */
function curve(p: { x: number; y: number }, ps: { w: number; h: number }, c: { x: number; y: number }, cs: { w: number; h: number }, o: MindmapOrientation): string {
  const f = (n: number) => Math.round(n * 10) / 10;
  if (o === 'ltr') {
    const sx = p.x + ps.w / 2;
    const ex = c.x - cs.w / 2;
    const mx = (sx + ex) / 2;
    return `M${f(sx)},${f(p.y)}C${f(mx)},${f(p.y)} ${f(mx)},${f(c.y)} ${f(ex)},${f(c.y)}`;
  }
  // Radial: leave the parent and reach the child along their own angles from the centre.
  const unit = (q: { x: number; y: number }) => { const l = Math.hypot(q.x, q.y) || 1; return { x: q.x / l, y: q.y / l }; };
  const uc = unit(c);
  const up = Math.hypot(p.x, p.y) < 1 ? uc : unit(p);
  const sp = { x: p.x + up.x * Math.min(ps.w, ps.h) / 2, y: p.y + up.y * Math.min(ps.w, ps.h) / 2 };
  const ec = { x: c.x - uc.x * Math.min(cs.w, cs.h) / 2, y: c.y - uc.y * Math.min(cs.w, cs.h) / 2 };
  const k = Math.hypot(ec.x - sp.x, ec.y - sp.y) / 2;
  return `M${f(sp.x)},${f(sp.y)}C${f(sp.x + up.x * k)},${f(sp.y + up.y * k)} ${f(ec.x - uc.x * k)},${f(ec.y - uc.y * k)} ${f(ec.x)},${f(ec.y)}`;
}
