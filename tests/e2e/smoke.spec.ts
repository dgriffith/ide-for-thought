/**
 * Electron smoke test (#394).
 *
 * The class of regression this catches is "the app starts and shows a
 * window" failure — the historical "black window" incident PR #305
 * was, plus the categories `svelte-check` and the unit suite cannot
 * see (preload-bridge mismatches, runtime errors during initial mount,
 * Electron-major-bump shape changes, CSP regressions strict enough to
 * block bootstrap).
 *
 * Strategy:
 *   1. Boot the *built* app via Playwright's `_electron.launch`. We
 *      use the in-tree `.vite/build/main.js` rather than the packaged
 *      .app so the build step is a one-liner (`vite build` for each
 *      target) instead of a 30-second `electron-forge package`.
 *   2. Wait for the first BrowserWindow to load.
 *   3. Capture renderer + main console errors and crash signals
 *      throughout. Fail if any land.
 *   4. Assert the welcome screen is rendered (no project open by
 *      default — a fresh launch yields the "Open Thoughtbase" shell).
 *   5. Quit cleanly.
 *
 * Deliberately NOT in this test:
 *   - File-tree interaction. The unit suite covers the IPC + graph;
 *     a click-here-type-three-chars dance is mostly re-testing what's
 *     already green and brittles up the smoke test. Add it once a
 *     regression of that shape actually slips through.
 */

import { test, expect, _electron as electron, type ConsoleMessage, type Page } from '@playwright/test';
import path from 'node:path';

// Playwright transpiles tests as CJS (no `"type": "module"` in
// package.json), so __dirname is available — using import.meta.url
// would force ESM and trip Playwright's loader.
const projectRoot = path.resolve(__dirname, '..', '..');

test('app launches, renderer mounts, no thrown errors', async () => {
  // page.on('pageerror') captures synchronous renderer-side throws
  // (the most common runtime regression). app.process().on('exit', ...)
  // catches main-process crashes mid-boot.
  const rendererErrors: Error[] = [];
  const consoleErrors: string[] = [];

  const app = await electron.launch({
    // `args: ['.']` boots Electron against the package.json `main`
    // entry — same as `electron .` in development.
    args: [projectRoot],
    cwd: projectRoot,
    timeout: 30_000,
  });

  try {
    const win: Page = await app.firstWindow({ timeout: 15_000 });

    win.on('pageerror', (err) => rendererErrors.push(err));
    win.on('console', (msg: ConsoleMessage) => {
      if (msg.type() === 'error') consoleErrors.push(msg.text());
    });

    // Wait for the renderer document to be ready. `domcontentloaded`
    // fires before runes get a chance to throw inside `$effect`, so
    // give the app a moment more to stabilise.
    await win.waitForLoadState('domcontentloaded');
    // The welcome screen renders once the Svelte tree mounts. Match
    // the H1 specifically — "Minerva" also appears in the titlebar.
    await expect(win.getByRole('heading', { name: 'Minerva' })).toBeVisible({ timeout: 10_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toBeVisible({ timeout: 10_000 });

    // Give async effects another beat to surface late errors.
    await win.waitForTimeout(500);
  } finally {
    await app.close();
  }

  // CSP / preload warnings the project intentionally suppresses don't
  // count — keep this filter narrow so it stays useful.
  const meaningful = consoleErrors.filter((m) =>
    !m.includes('Autofill.enable') && // Electron CDP noise on darwin
    !m.includes('Request Autofill'),
  );
  expect(rendererErrors, `renderer threw: ${rendererErrors.map((e) => e.message).join('; ')}`)
    .toHaveLength(0);
  expect(meaningful, `renderer console errors: ${meaningful.join('; ')}`).toHaveLength(0);
});
