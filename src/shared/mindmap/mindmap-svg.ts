/**
 * A laid-out mindmap as a standalone SVG (#2966): what an export draws for a
 * `:::mindmap` block, and what the map's own export will save (#2967). Plain
 * shapes with colours as attributes — an export keeps no `<style>` — each
 * node's wrapped label as lines, curved connectors as the layout made them.
 */
import { LINE_HEIGHT, type MindmapLayout } from './mindmap-layout';

export interface MindmapSvgColors {
  background: string;
  box: string;
  border: string;
  rootBorder: string;
  text: string;
  link: string;
}

/** A light page's colours: an export's. */
export const MINDMAP_EXPORT_COLORS: MindmapSvgColors = {
  background: '#ffffff', box: '#f4f2ee', border: '#a8a29a', rootBorder: '#8a5a1c', text: '#2a2522', link: '#b6aea4',
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const f = (n: number) => (Math.round(n * 10) / 10).toString();

export function mindmapSvg(layout: MindmapLayout, colors: MindmapSvgColors, opts: { title?: string; font?: string } = {}): string {
  const pad = 16;
  const { x1, y1, x2, y2 } = layout.bounds;
  const w = x2 - x1 + pad * 2;
  const h = y2 - y1 + pad * 2;
  const out: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x1 - pad)} ${f(y1 - pad)} ${f(w)} ${f(h)}" width="${f(w)}" height="${f(h)}" role="img"${opts.title ? ` aria-label="${esc(opts.title)}"` : ''} font-family="${esc(opts.font ?? 'system-ui, sans-serif')}" font-size="13">`,
  ];
  if (opts.title) out.push(`<title>${esc(opts.title)}</title>`);
  out.push(`<rect x="${f(x1 - pad)}" y="${f(y1 - pad)}" width="${f(w)}" height="${f(h)}" fill="${esc(colors.background)}"/>`);
  for (const l of layout.links) out.push(`<path d="${esc(l.path)}" fill="none" stroke="${esc(colors.link)}" stroke-width="1.5"/>`);
  for (const n of layout.nodes) {
    const left = n.x - n.width / 2;
    const top = n.y - n.height / 2;
    out.push(`<rect x="${f(left)}" y="${f(top)}" width="${f(n.width)}" height="${f(n.height)}" rx="7" fill="${esc(colors.box)}" stroke="${esc(n.depth === 0 ? colors.rootBorder : colors.border)}" stroke-width="${n.depth === 0 ? 2 : 1.2}"/>`);
    out.push(`<text x="${f(left + 10)}" y="${f(top + 6)}" fill="${esc(colors.text)}">${n.lines.map((line, i) => `<tspan x="${f(left + 10)}" dy="${i === 0 ? 13 : LINE_HEIGHT}">${esc(line)}</tspan>`).join('')}</text>`);
  }
  out.push('</svg>');
  return out.join('');
}
