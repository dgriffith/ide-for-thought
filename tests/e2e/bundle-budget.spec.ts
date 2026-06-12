/**
 * Renderer bundle-size guardrail (#691).
 *
 * #744 moved the heavy renderer deps (PDF.js, Tesseract) out of the eager
 * startup graph into lazy chunks. Nothing stopped that from silently regressing
 * — a single static `import PdfViewer from …` at the top of App.svelte would
 * pull pdfjs (~0.5M + 1.2M workers) straight back into the entry chunk, and no
 * test would notice. This locks it in.
 *
 * Runs in the e2e job (after `pnpm build:e2e` has produced the renderer build);
 * it's a pure build-artifact assertion, no Electron needed.
 *
 * KaTeX is deliberately NOT expected to be lazy: `shared/markdown/math-plugin`
 * is shared with the static-HTML publish exporters, which must render math
 * synchronously to a string (there's no DOM to hydrate at export time). So katex
 * stays eagerly imported — that's an architectural constraint, documented on #691,
 * not a regression.
 */

import { test, expect } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';

const ASSETS = path.resolve(__dirname, '..', '..', '.vite', 'renderer', 'main_window', 'assets');

// The eager entry chunk is ~3.33MB today, dominated by CodeMirror (the editor —
// the primary view, intentionally eager). The budget sits ~370KB above that:
// enough headroom for ordinary growth, but below the smallest heavy lazy dep
// (Tesseract/OCR ~0.45M, PDF.js ~0.49M, Mermaid ~0.58M), so any of them merging
// back into the entry trips it. Bump it *deliberately* if honest growth trips it.
const MAX_ENTRY_BYTES = 3_700_000;

function assets(): string[] {
  return fs.readdirSync(ASSETS);
}

test('renderer entry chunk stays under budget (heavy deps stay code-split)', () => {
  test.skip(!fs.existsSync(ASSETS), 'renderer not built — run `pnpm build:e2e` first');

  const entries = assets()
    .filter((f) => /^index-.*\.js$/.test(f))
    .map((f) => ({ f, size: fs.statSync(path.join(ASSETS, f)).size }))
    .sort((a, b) => b.size - a.size);

  expect(entries[0], 'no index-*.js entry chunk found in the renderer build').toBeTruthy();
  const { f, size } = entries[0];
  expect(
    size,
    `entry chunk ${f} is ${(size / 1e6).toFixed(2)}MB, over the ${(MAX_ENTRY_BYTES / 1e6).toFixed(2)}MB budget — ` +
      `a heavy dependency likely merged back into the eager startup graph (see #691/#744).`,
  ).toBeLessThan(MAX_ENTRY_BYTES);
});

test('PDF.js and Tesseract/OCR ship as separate lazy chunks', () => {
  test.skip(!fs.existsSync(ASSETS), 'renderer not built — run `pnpm build:e2e` first');

  const files = assets();
  expect(files.some((f) => /^pdf-.*\.js$/.test(f)), 'expected a separate pdfjs (`pdf-*.js`) chunk').toBe(true);
  expect(
    files.some((f) => /^OcrProgressDialog-.*\.js$/.test(f)),
    'expected a separate OCR (`OcrProgressDialog-*.js`, carries tesseract.js) chunk',
  ).toBe(true);
});
