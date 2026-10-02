/**
 * @vitest-environment happy-dom
 *
 * Preview charts take their colours from the theme (#2522) — and in every
 * theme the app ships, the chart's text clears WCAG AA against the preview
 * background. Measured from the real tokens in global.css, not assumed.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { chartPaletteFrom } from '../../../src/renderer/lib/charts/theme-palette';
import { normalizeColor } from '../../../src/renderer/lib/utils/oklch';

const CSS = fs.readFileSync(path.resolve(__dirname, '../../../src/renderer/styles/global.css'), 'utf-8');

/** The first block for `selector` in global.css, as a token → value map. */
function themeTokens(selector: string): Record<string, string> {
  const start = CSS.indexOf(`${selector} {`);
  if (start < 0) throw new Error(`no ${selector} block`);
  const body = CSS.slice(start, CSS.indexOf('\n}', start));
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]!] = m[2]!.trim();
  return out;
}

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

describe('chartPaletteFrom', () => {
  it('reads the theme tokens where the chart renders, oklch normalized to hex', () => {
    const el = document.createElement('div');
    el.style.setProperty('--text', 'oklch(0.3 0.02 80)');
    el.style.setProperty('--text-muted', '#555555');
    el.style.setProperty('--border', 'oklch(0.85 0.01 80)');
    document.body.appendChild(el);
    const p = chartPaletteFrom(el)!;
    expect(p.text).toMatch(/^#[0-9a-f]{6}$/);
    expect(p.tick).toBe('#555555');
    expect(p.grid).toMatch(/^#[0-9a-f]{6}55$/); // the border, translucent
    el.remove();
  });

  it('gives no palette when there are no tokens (the adapter\'s default applies)', () => {
    expect(chartPaletteFrom(document.createElement('div'))).toBeUndefined();
  });
});

describe('chart text contrast in every theme (#2522)', () => {
  const dark = themeTokens(':root');
  const themes: Record<string, Record<string, string>> = {
    dark,
    light: { ...dark, ...themeTokens('[data-theme="light"]') },
    contrast: { ...dark, ...themeTokens('[data-theme="contrast"]') },
  };
  for (const [name, t] of Object.entries(themes)) {
    it(`${name}: the title/legend and the tick labels clear 4.5:1 on the preview background`, () => {
      const bg = normalizeColor(t['--bg']!);
      expect(contrast(normalizeColor(t['--text']!), bg), 'title/legend').toBeGreaterThanOrEqual(4.5);
      expect(contrast(normalizeColor(t['--text-muted']!), bg), 'ticks').toBeGreaterThanOrEqual(4.5);
    });
  }

  it('…which the old hard-coded title colour did not, in the light theme (the bug)', () => {
    const light = { ...themes.dark, ...themeTokens('[data-theme="light"]') };
    expect(contrast('#cdd6f4', normalizeColor(light['--bg']!))).toBeLessThan(4.5);
  });
});
