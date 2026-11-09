/**
 * Colours for Cytoscape, which parses them itself and knows hex, rgb, hsl and
 * names — not the theme's `oklch(…)`. Each is resolved by painting it, the way
 * the app's own graph does (#2958).
 */
let ctx: CanvasRenderingContext2D | null | undefined;

/** A CSS colour as `rgb(…)` / `rgba(…)`; `fallback` when it can't be read. */
export function rgb(color: string, fallback: string): string {
  const c = color.trim();
  if (c === '') return fallback;
  if (ctx === undefined) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 1;
    ctx = canvas.getContext('2d', { willReadFrequently: true });
  }
  if (!ctx) return c; // no canvas to paint on: as written
  ctx.clearRect(0, 0, 1, 1);
  ctx.fillStyle = '#000';
  ctx.fillStyle = c;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
  return a === 255 ? `rgb(${r}, ${g}, ${b})` : `rgba(${r}, ${g}, ${b}, ${((a ?? 0) / 255).toFixed(3)})`;
}

/** A theme token as rgb. */
export function token(name: string, fallback: string): string {
  return rgb(getComputedStyle(document.documentElement).getPropertyValue(name), fallback);
}

/** One colour per kind of link, from the theme's accents, in turn. */
export const KIND_TOKENS = ['--accent', '--sage', '--rust', '--iris', '--hl-blue', '--hl-orange', '--hl-pink', '--hl-green'];
