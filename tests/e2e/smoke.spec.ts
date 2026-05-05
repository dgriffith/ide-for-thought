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
  // Buffer everything the main process writes to stderr/stdout so we have
  // post-mortem evidence on CI when launch hangs (#518). Nothing useful
  // gets surfaced by Playwright's own log on a launch timeout — it just
  // says "Timeout 30000ms exceeded" — so we tap directly via stream events
  // attached after launch. (Pre-launch output is rare; mostly Node debugger
  // banners that we don't need.)
  const mainStderr: string[] = [];
  const mainStdout: string[] = [];

  // GitHub's macos-latest runner is currently macOS Sequoia on Apple
  // Silicon. Electron 35 there has a recurring hang signature with
  // Playwright: Debugger attaches, then `firstWindow` never fires —
  // GPU/sandbox initialisation deadlocks without user-level seatbelt
  // privileges that interactive sessions normally grant. The standard
  // workaround is to launch with the flags below (#518). Locally we
  // skip them — they suppress GPU compositing, which is fine for a
  // boot-and-assert smoke test but unnecessary on dev machines.
  const ciArgs = process.env.CI
    ? ['--disable-gpu', '--no-sandbox', '--disable-software-rasterizer']
    : [];

  const app = await electron.launch({
    // `args: ['.']` boots Electron against the package.json `main`
    // entry — same as `electron .` in development.
    args: [projectRoot, ...ciArgs],
    cwd: projectRoot,
    // 60s — local boot is ~3s. The 30s default was tight enough on CI
    // that a slow runner cold-start could legitimately exceed it (#518).
    timeout: 60_000,
    env: {
      ...process.env,
      // Tell Electron to log boot/IPC/render activity to stderr — only
      // matters when something goes wrong (we read the buffer below);
      // otherwise it just adds noise to a passing run.
      ELECTRON_ENABLE_LOGGING: '1',
    },
  });

  // Tap streams immediately after launch so we capture everything from
  // the moment Electron starts producing output.
  app.process().stderr?.on('data', (chunk: Buffer) => {
    mainStderr.push(chunk.toString());
  });
  app.process().stdout?.on('data', (chunk: Buffer) => {
    mainStdout.push(chunk.toString());
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
  } catch (err) {
    // On hang/timeout, dump everything the main process said. The
    // Playwright failure message alone ("electron.launch: Timeout") is
    // useless for diagnosing a CI-only hang (#518).
    if (mainStderr.length) console.error(`[smoke] main stderr:\n${mainStderr.join('')}`);
    if (mainStdout.length) console.error(`[smoke] main stdout:\n${mainStdout.join('')}`);
    throw err;
  } finally {
    await app.close().catch(() => { /* already exited */ });
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
