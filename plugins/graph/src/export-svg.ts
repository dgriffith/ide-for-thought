/**
 * The Graph layout's export (#2961): the view's graph as a still SVG with a
 * key of the kinds of link drawn — laid out here, at once (an exported view
 * is a note's embed, not a thoughtbase), with the shared force layout and
 * drawn by the shared serializer, every colour resolved from the export's
 * theme tokens. A note outside the view is faded and dashed, as on screen.
 */
import { layoutGraph, ticksFor } from '../../../src/shared/graph/force-layout';
import { graphSvg } from '../../../src/shared/graph/graph-svg';
import type { GraphViewModel } from '../../../src/shared/objects/graph-view';
import { KIND_TOKENS, rgb, token } from './colors';

export function exportSvg(model: GraphViewModel, title: string): string {
  let xy: Float64Array = new Float64Array(model.nodes.length * 2);
  layoutGraph(
    model.nodes.map((n) => ({ id: n.id, group: n.outside ? '~outside' : n.typeLabel ?? '' })),
    model.edges.map((e) => ({ source: e.source, target: e.target })),
    { ticks: ticksFor(model.nodes.length), every: Number.MAX_SAFE_INTEGER, distance: 110, repulsion: 400, onPositions: (p) => { xy = p; } },
  );
  const border = token('--border-strong', 'rgb(160, 160, 160)');
  const kindColor = new Map(model.kinds.map((k, i) => [k.property, token(KIND_TOKENS[i % KIND_TOKENS.length]!, border)] as const));
  return graphSvg({
    title,
    background: token('--bg', 'rgb(255, 255, 255)'),
    text: token('--text', 'rgb(30, 30, 30)'),
    font: getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || undefined,
    nodes: model.nodes.map((n, i) => ({
      id: n.id, label: n.label, x: xy[2 * i] ?? 0, y: xy[2 * i + 1] ?? 0,
      fill: token('--bg-elev-2', 'rgb(235, 235, 235)'),
      stroke: n.outside ? border : n.color ? rgb(n.color, border) : border,
      text: token('--text', 'rgb(30, 30, 30)'),
      ...(n.outside ? { dashed: true, opacity: 0.55 } : {}),
    })),
    edges: model.edges.map((e) => ({ source: e.source, target: e.target, color: kindColor.get(e.property) ?? border, ...(e.outside ? { dashed: true, opacity: 0.5 } : {}) })),
    legend: model.kinds.filter((k) => k.on && k.count > 0).map((k) => ({ label: k.label, color: kindColor.get(k.property) ?? border })),
  });
}
