/**
 * Real-browser axe-core pass for the Playwright/Electron e2e suite (#1005).
 *
 * The jsdom component net (`tests/helpers/axe.ts`) disables `color-contrast`
 * because jsdom computes no layout or colours. Here we run against the actual
 * Electron renderer, so Chromium DOES compute layout and colour — enabling the
 * `color-contrast` check the unit pass can't do. Injects axe-core from
 * node_modules into the page and runs it there.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import type { Page } from '@playwright/test';

const require = createRequire(__filename);
// axe-core's main entry is a UMD bundle; running it defines `window.axe`.
const AXE_SOURCE = fs.readFileSync(require.resolve('axe-core'), 'utf8');

export interface AxeViolationNode {
  html: string;
  target: string[];
  failureSummary?: string;
}
export interface AxeViolation {
  id: string;
  impact: 'minor' | 'moderate' | 'serious' | 'critical' | null;
  help: string;
  helpUrl: string;
  nodes: AxeViolationNode[];
}

/**
 * Inject axe-core and run it against `context` (a CSS selector, or the whole
 * document by default). `color-contrast` is ON — that's the point of the
 * real-browser pass. Returns the raw violations.
 */
export async function runAxe(page: Page, context?: string): Promise<AxeViolation[]> {
  // The app ships a hardened CSP (`script-src 'self' 'wasm-unsafe-eval' blob:`)
  // that blocks Playwright's `addScriptTag` inline injection. blob: URLs ARE
  // allowed, so load axe from an object URL — which also proves the pass runs
  // under the real production CSP, not a relaxed test one.
  await page.evaluate(async (src) => {
    if ((globalThis as unknown as { axe?: unknown }).axe) return;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    try {
      await new Promise<void>((resolve, reject) => {
        const s = document.createElement('script');
        s.src = url;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('axe-core failed to load'));
        document.head.appendChild(s);
      });
    } finally {
      URL.revokeObjectURL(url);
    }
  }, AXE_SOURCE);
  return page.evaluate(async (ctx) => {
    // `axe` is defined on window by the injected UMD bundle.
    const axe = (globalThis as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: AxeViolation[] }> } }).axe;
    const results = await axe.run(ctx ?? document, {
      // WCAG 2.0/2.1 A + AA — the level a professional tool should meet.
      runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'] },
    });
    return results.violations;
  }, context);
}

/** Human-readable violation dump for a failing assertion. */
export function formatViolations(violations: AxeViolation[]): string {
  if (violations.length === 0) return 'no violations';
  return violations
    .map((v) =>
      `  • [${v.impact ?? 'n/a'}] ${v.id} — ${v.help} (${v.helpUrl})\n` +
      v.nodes.map((n) => `      ${n.target.join(' ')} :: ${n.html}`).join('\n'),
    )
    .join('\n');
}

/** Filter to the impacts that should gate CI (serious + critical). */
export function seriousOrWorse(violations: AxeViolation[]): AxeViolation[] {
  return violations.filter((v) => v.impact === 'serious' || v.impact === 'critical');
}
