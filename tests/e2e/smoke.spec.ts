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

import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import {
  launchMinerva,
  makeTempDir,
  seedSession,
  projectRoot,
} from './helpers/launch';

/** Path to the packaged app binary, or null if it hasn't been built. */
function packagedBinary(): string | null {
  if (process.platform !== 'darwin') return null; // only darwin .app layout handled
  const p = path.join(
    projectRoot,
    'out',
    `Minerva-${process.platform}-${process.arch}`,
    'Minerva.app',
    'Contents',
    'MacOS',
    'Minerva',
  );
  return fs.existsSync(p) ? p : null;
}

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

  // A fresh, empty profile. This test asserts the *welcome* screen, which
  // only appears when no project is restored — so booting the developer's
  // real profile made it assert the opposite of what it says (#1928). It was
  // green in CI, where the profile is always empty, and red on any machine
  // that had actually used the app.
  const userDataDir = makeTempDir('minerva-e2e-smoke-userdata-');
  const app = await launchMinerva({ userDataDir });

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
    fs.rmSync(userDataDir, { recursive: true, force: true });
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

/**
 * Packaging regression: the *packaged* app opens a project that uses DuckDB
 * tables (#691 follow-up). The test above boots `.vite/build/main.js` against
 * the repo, so it uses the dev `node_modules` and never exercises what actually
 * shipped. @electron-forge/plugin-vite bundles the main process and ships no
 * node_modules, so the externalized `@duckdb/node-bindings` native binary has to
 * be copied in by forge.config's `afterPrune` hook — and if it isn't, the app
 * dies at first DuckDB use with "cannot find @duckdb/node-bindings".
 *
 * We launch the packaged binary against a seeded session that restores a
 * CSV-bearing fixture, so `registerAllCsvs` runs DuckDB on launch. A copy of the
 * fixture is used so the run can't dirty the git-tracked one.
 */
test('packaged app opens a DuckDB-backed project (native binding shipped)', async () => {
  const appBinary = packagedBinary();
  test.skip(appBinary === null, 'packaged app not built — run `pnpm build:e2e` first');

  const userDataDir = makeTempDir('minerva-e2e-userdata-');
  const projectDir = makeTempDir('minerva-e2e-project-');
  // Copy the fixture (it has newData.csv → registerAllCsvs → DuckDB) so the
  // launch can't mutate the tracked fixture (search-index persist, etc.).
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seedSession(userDataDir, projectDir);

  const mainOut: string[] = [];
  const app = await launchMinerva({ userDataDir, executablePath: appBinary as string });
  app.process().stderr?.on('data', (chunk: Buffer) => mainOut.push(chunk.toString()));
  app.process().stdout?.on('data', (chunk: Buffer) => mainOut.push(chunk.toString()));

  let openedProject = false;
  try {
    const win: Page = await app.firstWindow({ timeout: 20_000 });
    await win.waitForLoadState('domcontentloaded');
    // Session restore opens the project in `did-finish-load` → acquireProject →
    // registerAllCsvs (DuckDB). On success the welcome screen is replaced by the
    // workspace, so the "Open Thoughtbase" button disappears; on a missing
    // binding, registerAllCsvs throws, the project never opens, and the error
    // lands on the main stream. Poll for the workspace, tolerating the failure
    // case so the clearer stderr assertion below runs.
    try {
      await expect(win.getByRole('button', { name: 'Open Thoughtbase' }))
        .toHaveCount(0, { timeout: 25_000 });
      openedProject = true;
    } catch { /* fall through to the stream assertion for a clearer message */ }
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }

  const out = mainOut.join('');
  expect(
    /cannot find.*duckdb|@duckdb\/node-bindings/i.test(out),
    `DuckDB native binding failed to load in the packaged app:\n${out}`,
  ).toBe(false);
  expect(openedProject, 'the restored project never opened (workspace never replaced the welcome screen)').toBe(true);
});
