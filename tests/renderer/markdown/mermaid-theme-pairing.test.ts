/**
 * @vitest-environment happy-dom
 *
 * Mermaid's cluster/tertiary fill pairs with the text drawn on it (#2688).
 *
 * `initializeWith` hands mermaid one global set of `themeVariables`. Every
 * text and line colour in it is a body token (`--text`, `--text-muted`), so
 * every fill those land on must be a body surface. The cluster fill and
 * `tertiaryColor` used to be `--bg-titlebar`: in dark and light that IS
 * `--bg-elev`, but the contrast theme keeps a dark `#3a3a4a` title bar over a
 * light body, so subgraph titles (and edges inside the subgraph) rendered
 * dark-on-dark there and nowhere else. `tertiaryColor` also feeds state
 * alt-composites, ER relationship labels, mindmap/timeline/kanban section 2,
 * git branch 2, pie slices 3 and 6, tooltips and more in mermaid's `base`
 * theme, all drawn with body text.
 *
 * Axe can't see text inside mermaid's SVG, so `a11y.spec.ts` never caught it.
 * This measures the real tokens from global.css, run through the real
 * `readThemeTokens` → `initializeWith` path (via the export entry point, which
 * themes from whatever element it is handed).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { normalizeColor } from '../../../src/renderer/lib/utils/oklch';

const initialize = vi.fn();
const render = vi.fn(async () => ({ svg: '<svg xmlns="http://www.w3.org/2000/svg"></svg>' }));
vi.mock('mermaid', () => ({ default: { initialize, render } }));
vi.mock('../../../src/renderer/lib/theme', () => ({
  getThemeMode: () => 'dark',
  getEffectiveTheme: () => 'dark',
}));

import { renderMermaidSvgForExport } from '../../../src/renderer/lib/markdown/mermaid-renderer';

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

/** Resolve `var(--x)` aliases the way the cascade would on one element. */
function resolve(tokens: Record<string, string>): Record<string, string> {
  const get = (name: string, depth = 0): string => {
    const v = tokens[name];
    if (v === undefined) throw new Error(`undefined token ${name}`);
    if (depth > 10) throw new Error(`var() cycle at ${name}`);
    return v.replace(/var\(\s*(--[\w-]+)\s*\)/g, (_, ref: string) => get(ref, depth + 1));
  };
  return Object.fromEntries(Object.keys(tokens).map((k) => [k, get(k)]));
}

const dark = themeTokens(':root');
const THEMES: Record<string, Record<string, string>> = {
  dark: resolve(dark),
  light: resolve({ ...dark, ...themeTokens('[data-theme="light"]') }),
  contrast: resolve({ ...dark, ...themeTokens('[data-theme="contrast"]') }),
};

const luminance = (hex: string): number => {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string): number => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};

/** The themeVariables mermaid is initialized with, themed from `tokens`. */
async function themeVariablesFor(tokens: Record<string, string>): Promise<Record<string, string>> {
  const host = document.createElement('div');
  for (const [k, v] of Object.entries(tokens)) host.style.setProperty(k, v);
  document.body.appendChild(host);
  try {
    await renderMermaidSvgForExport('flowchart TD\n  subgraph S\n    A --> B\n  end', host, 'sans-serif');
  } finally {
    host.remove();
  }
  const call = initialize.mock.calls.at(-1)?.[0] as { themeVariables: Record<string, string> };
  return call.themeVariables;
}

describe('mermaid cluster / tertiary fills pair with their text (#2688)', () => {
  beforeEach(() => initialize.mockClear());

  for (const [theme, tokens] of Object.entries(THEMES)) {
    it(`${theme}: text on a cluster or tertiary fill clears 4.5:1, lines clear 3:1`, async () => {
      const tv = await themeVariablesFor(tokens);
      const fails: string[] = [];
      for (const fill of ['clusterBkg', 'tertiaryColor'] as const) {
        for (const ink of ['titleColor', 'textColor'] as const) {
          const r = contrast(tv[ink]!, tv[fill]!);
          if (r < 4.5) fails.push(`${ink} ${tv[ink]} on ${fill} ${tv[fill]}: ${r.toFixed(2)}:1`);
        }
        // Edges inside a subgraph — non-text, so WCAG 1.4.11's 3:1.
        const r = contrast(tv.lineColor!, tv[fill]!);
        if (r < 3) fails.push(`lineColor ${tv.lineColor} on ${fill} ${tv[fill]}: ${r.toFixed(2)}:1`);
      }
      expect(fails).toEqual([]);
    });
  }

  // The fix must not repaint the two themes people look at most: there the
  // cluster fill is exactly what --bg-titlebar resolved to before.
  for (const theme of ['dark', 'light'] as const) {
    it(`${theme}: the cluster and tertiary fills are unchanged (--bg-titlebar's colour)`, async () => {
      const tv = await themeVariablesFor(THEMES[theme]!);
      const titlebar = normalizeColor(THEMES[theme]!['--bg-titlebar']!);
      expect(tv.clusterBkg).toBe(titlebar);
      expect(tv.tertiaryColor).toBe(titlebar);
    });
  }
});
