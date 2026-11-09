/**
 * The thoughtbase graph tab as an image (#2961): an SVG of what Cytoscape is
 * drawing — every note where it is, with the colours, fading and marks it has
 * now (a trace, a find, a dimmed focus) — for the current camera or the whole
 * graph, and a PNG rasterized from that SVG.
 */
import type { Core } from 'cytoscape';
import { graphSvg, type SvgEdge, type SvgNode } from '../../../shared/graph/graph-svg';

export interface GraphImageOptions {
  /** Only what the camera shows; otherwise every note. */
  view: boolean;
  /** The kinds of link drawn, for the key. */
  legend: readonly { label: string; color: string }[];
  background: string;
  text: string;
  title: string;
}

const px = (v: string) => Number.parseFloat(v) || 0;
/** A computed style, as text (Cytoscape types it `any`). */
const st = (el: { style(name: string): unknown }, name: string): string => String(el.style(name));

export function cyToSvg(cy: Core, opts: GraphImageOptions): string {
  const nodes: SvgNode[] = cy.nodes().map((n) => {
    const p = n.position();
    const opacity = Number(st(n, 'opacity'));
    return {
      id: n.id(), label: String(n.data('label') ?? n.id()), x: p.x, y: p.y,
      fill: st(n, 'background-color'), stroke: st(n, 'border-color'), text: st(n, 'color'),
      strokeWidth: Math.max(1, px(st(n, 'border-width'))),
      // As Cytoscape drew it: its box and font, not an estimate.
      // The stroke is centred on the rect's edge: the box's outer size less one border width.
      width: n.outerWidth() - px(st(n, 'border-width')), height: n.outerHeight() - px(st(n, 'border-width')),
      fontSize: px(st(n, 'font-size')) || 11,
      ...(st(n, 'border-style') === 'dashed' ? { dashed: true } : {}),
      ...(opacity < 1 ? { opacity } : {}),
    };
  });
  const edges: SvgEdge[] = cy.edges().map((e) => {
    const opacity = Number(st(e, 'opacity'));
    return {
      source: String(e.data('source')), target: String(e.data('target')), color: st(e, 'line-color'),
      width: Math.max(1, px(st(e, 'width'))),
      ...(st(e, 'line-style') === 'dashed' ? { dashed: true } : {}),
      ...(opacity < 1 ? { opacity } : {}),
      ...(st(e, 'target-arrow-shape') === 'none' ? { arrow: false } : {}),
    };
  });
  const ext = cy.extent();
  return graphSvg({
    nodes, edges, legend: opts.legend, background: opts.background, text: opts.text, title: opts.title,
    font: getComputedStyle(document.documentElement).getPropertyValue('--font-sans').trim() || undefined,
    ...(opts.view ? { viewport: { x1: ext.x1, y1: ext.y1, x2: ext.x2, y2: ext.y2 } } : {}),
  });
}

/** The longest side a PNG is drawn at, in pixels: a whole large graph is scaled down to it. */
export const PNG_MAX_SIDE = 8000;

/**
 * The SVG drawn onto a canvas and read back as PNG bytes, base64. `scale` is
 * pixels per graph unit — the camera's zoom for the current view, so the PNG
 * is what's on screen, at twice the density — capped at `PNG_MAX_SIDE`.
 */
export async function svgToPngBase64(svg: string, scale = 2): Promise<string> {
  const size = /viewBox="[^ ]+ [^ ]+ ([\d.]+) ([\d.]+)"/.exec(svg);
  const sw = Number(size?.[1] ?? 800);
  const sh = Number(size?.[2] ?? 600);
  // At least 1,200 pixels across, so a small graph isn't a thumbnail; never past the cap.
  const k = Math.min(Math.max(scale, 1200 / sw), PNG_MAX_SIDE / Math.max(sw, sh));
  const w = Math.max(1, Math.round(sw * k));
  const h = Math.max(1, Math.round(sh * k));
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No canvas to draw the image on');
  ctx.drawImage(img, 0, 0, w, h);
  return canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');
}

/** A CSS colour (a theme's `oklch(…)`, a `var()` already resolved) as `rgb(…)`, by painting it. */
export function resolveColor(color: string): string {
  const ctx = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
  if (!ctx) return color;
  ctx.fillStyle = '#000';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}
