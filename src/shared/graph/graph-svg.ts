/**
 * A drawn graph as a standalone SVG (#2961): what the thoughtbase graph tab
 * saves as SVG (and rasterizes to PNG), and what the Graph layout hands an
 * export. Shared because the layout is drawn by a plugin, which may import
 * only `src/shared/`.
 *
 * Plain shapes only — a rounded box and a label per note, a line per link,
 * its arrowhead a polygon — with every colour resolved and set as an
 * attribute: an export's sanitizer keeps no `<style>` and drops any `url(`,
 * so neither CSS nor `marker-end` would survive it.
 */

export interface SvgNode {
  id: string;
  label: string;
  /** Centre, in graph coordinates. */
  x: number;
  y: number;
  fill: string;
  stroke: string;
  text: string;
  strokeWidth?: number;
  dashed?: boolean;
  opacity?: number;
  /** The box's size, where it's known (a drawn graph's); otherwise estimated from the label. */
  width?: number;
  height?: number;
  fontSize?: number;
}

export interface SvgEdge {
  source: string;
  target: string;
  color: string;
  width?: number;
  dashed?: boolean;
  opacity?: number;
  /** Draw an arrowhead at the target (default true). */
  arrow?: boolean;
}

export interface GraphSvgInput {
  nodes: readonly SvgNode[];
  edges: readonly SvgEdge[];
  /** The kinds of link drawn, shown as a key under the graph. */
  legend?: readonly { label: string; color: string }[];
  background: string;
  /** The legend's text colour. */
  text: string;
  font?: string | undefined;
  /** Only this rectangle of the graph (the current camera); absent, all of it. */
  viewport?: { x1: number; y1: number; x2: number; y2: number } | undefined;
  /** What a screen reader reads for the image. */
  title?: string;
}

const FONT_SIZE = 11;
const BOX_H = 22;
const PAD = 24;
const LEGEND_ROW = 18;

/** A box wide enough for its label: an estimate, since nothing is measured outside a page. */
export function boxWidth(label: string): number {
  return Math.min(180, Math.max(28, label.length * FONT_SIZE * 0.58 + 14));
}

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const num = (n: number) => (Math.round(n * 10) / 10).toString();

/** Where the line from `from` to the box at `to` meets that box's edge. */
function clipToBox(from: { x: number; y: number }, to: { x: number; y: number; w: number; h: number }): { x: number; y: number } {
  const dx = from.x - to.x;
  const dy = from.y - to.y;
  if (dx === 0 && dy === 0) return { x: to.x, y: to.y };
  const sx = dx === 0 ? Infinity : (to.w / 2) / Math.abs(dx);
  const sy = dy === 0 ? Infinity : (to.h / 2) / Math.abs(dy);
  const s = Math.min(sx, sy);
  return { x: to.x + dx * s, y: to.y + dy * s };
}

export function graphSvg(input: GraphSvgInput): string {
  const boxes = new Map(input.nodes.map((n) => [n.id, { ...n, w: n.width ?? boxWidth(n.label), h: n.height ?? BOX_H }] as const));
  // The picture's extent: the camera's, or every box with a margin.
  let x1: number, y1: number, x2: number, y2: number;
  if (input.viewport) ({ x1, y1, x2, y2 } = input.viewport);
  else if (boxes.size === 0) { x1 = 0; y1 = 0; x2 = 200; y2 = 80; }
  else {
    x1 = Infinity; y1 = Infinity; x2 = -Infinity; y2 = -Infinity;
    for (const b of boxes.values()) {
      x1 = Math.min(x1, b.x - b.w / 2); x2 = Math.max(x2, b.x + b.w / 2);
      y1 = Math.min(y1, b.y - b.h / 2); y2 = Math.max(y2, b.y + b.h / 2);
    }
    x1 -= PAD; y1 -= PAD; x2 += PAD; y2 += PAD;
  }
  const legend = input.legend ?? [];
  const legendH = legend.length > 0 ? legend.length * LEGEND_ROW + 12 : 0;
  const width = x2 - x1;
  const height = y2 - y1 + legendH;
  const font = esc(input.font ?? 'system-ui, sans-serif');
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${num(x1)} ${num(y1)} ${num(width)} ${num(height)}" width="${num(width)}" height="${num(height)}" role="img"${input.title ? ` aria-label="${esc(input.title)}"` : ''} font-family="${font}" font-size="${FONT_SIZE}">`);
  if (input.title) out.push(`<title>${esc(input.title)}</title>`);
  out.push(`<rect x="${num(x1)}" y="${num(y1)}" width="${num(width)}" height="${num(height)}" fill="${esc(input.background)}"/>`);
  for (const e of input.edges) {
    const a = boxes.get(e.source);
    const b = boxes.get(e.target);
    if (!a || !b || a === b) continue;
    const start = clipToBox(b, a);
    const end = clipToBox(a, b);
    const attrs = `stroke="${esc(e.color)}" stroke-width="${num(e.width ?? 1.5)}"${e.dashed ? ' stroke-dasharray="5 4"' : ''}${e.opacity !== undefined && e.opacity < 1 ? ` opacity="${num(e.opacity)}"` : ''}`;
    out.push(`<line x1="${num(start.x)}" y1="${num(start.y)}" x2="${num(end.x)}" y2="${num(end.y)}" ${attrs}/>`);
    if (e.arrow !== false) {
      const len = Math.hypot(end.x - start.x, end.y - start.y) || 1;
      const ux = (end.x - start.x) / len;
      const uy = (end.y - start.y) / len;
      const back = { x: end.x - ux * 8, y: end.y - uy * 8 };
      const p1 = `${num(back.x - uy * 4)},${num(back.y + ux * 4)}`;
      const p2 = `${num(back.x + uy * 4)},${num(back.y - ux * 4)}`;
      out.push(`<polygon points="${num(end.x)},${num(end.y)} ${p1} ${p2}" fill="${esc(e.color)}"${e.opacity !== undefined && e.opacity < 1 ? ` opacity="${num(e.opacity)}"` : ''}/>`);
    }
  }
  for (const b of boxes.values()) {
    const op = b.opacity !== undefined && b.opacity < 1 ? ` opacity="${num(b.opacity)}"` : '';
    out.push(`<g${op}>`);
    out.push(`<rect x="${num(b.x - b.w / 2)}" y="${num(b.y - b.h / 2)}" width="${num(b.w)}" height="${num(b.h)}" rx="5" fill="${esc(b.fill)}" stroke="${esc(b.stroke)}" stroke-width="${num(b.strokeWidth ?? 1.5)}"${b.dashed ? ' stroke-dasharray="4 3"' : ''}/>`);
    const label = b.label.length > 30 ? `${b.label.slice(0, 29)}…` : b.label;
    const size = b.fontSize !== undefined && b.fontSize !== FONT_SIZE ? ` font-size="${num(b.fontSize)}"` : '';
    out.push(`<text x="${num(b.x)}" y="${num(b.y)}" text-anchor="middle" dominant-baseline="central" fill="${esc(b.text)}"${size}>${esc(label)}</text>`);
    out.push('</g>');
  }
  legend.forEach((k, i) => {
    const y = y2 + 12 + i * LEGEND_ROW;
    out.push(`<line x1="${num(x1 + 12)}" y1="${num(y + 6)}" x2="${num(x1 + 32)}" y2="${num(y + 6)}" stroke="${esc(k.color)}" stroke-width="3"/>`);
    out.push(`<text x="${num(x1 + 40)}" y="${num(y + 6)}" dominant-baseline="central" fill="${esc(input.text)}">${esc(k.label)}</text>`);
  });
  out.push('</svg>');
  return out.join('');
}
