/**
 * A chart palette from the theme the chart renders in (#2522). The preview's
 * charts used hard-coded colours from the old dark palette (#cdd6f4 text), so
 * in the light theme a chart title was pale blue on beige. Reading the tokens
 * where the chart mounts makes every theme — and an export's light host, which
 * passes its own palette — correct by construction.
 *
 * Tokens are authored in `oklch()`; Chart.js's colour helper only parses
 * rgb/hsl/hex, so each is normalized to hex (the same conversion mermaid's
 * theming uses).
 */
import { normalizeColor } from '../utils/oklch';
import type { ChartPalette } from './chartjs-adapter';

/** Grid lines are the border colour at this opacity: present, not loud. */
const GRID_ALPHA = '55';

export function chartPaletteFrom(el: Element): ChartPalette | undefined {
  const cs = getComputedStyle(el);
  const token = (name: string) => normalizeColor(cs.getPropertyValue(name).trim());
  const text = token('--text');
  const tick = token('--text-muted');
  const border = token('--border');
  // No theme tokens resolved (a detached element, a test) → the adapter's default.
  if (!text || !tick || !border) return undefined;
  return { text, tick, grid: /^#[0-9a-f]{6}$/i.test(border) ? `${border}${GRID_ALPHA}` : border };
}
