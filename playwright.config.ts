/**
 * Playwright config for the Electron smoke suite (#394).
 *
 * Vitest still owns unit/integration testing under `tests/main`,
 * `tests/renderer`, `tests/shared`. Playwright is scoped strictly to
 * `tests/e2e/` — boot Electron, click a thing, assert nothing
 * exploded. Keep the two suites independent so the unit loop stays
 * sub-second and Electron boot (5–10s) doesn't slow it.
 */

import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/e2e',
  // Single worker — Electron instances aren't cheap to launch in
  // parallel and the suite is small.
  workers: 1,
  // 60s per test gives headroom for the first BrowserWindow to load
  // on a cold CI runner; Electron boot alone is ~3-5s.
  timeout: 60_000,
  // Electron boot is inherently flaky (transient BrowserWindow load
  // failures on cold CI runners). Retry twice in CI so a single boot
  // hiccup doesn't fail the job; keep 0 locally so real failures surface
  // immediately (#1097).
  retries: process.env.CI ? 2 : 0,
  // `list` prints a "retry #N" line for every retried spec, so genuine
  // flake stays visible in the CI log rather than being silently masked.
  // `json` feeds scripts/e2e-flake-report.mjs (#1946) — nothing previously
  // aggregated those "retry #N" lines, so a test that needed a retry on
  // every single run was indistinguishable from one that always passed.
  reporter: [['list'], ['json', { outputFile: 'playwright-report.json' }]],
  use: {
    actionTimeout: 10_000,
    // Bounds `reload` / `waitForLoadState` / `waitForURL` (#2458). Playwright
    // Test applies this only to contexts it creates, so launchMinerva applies
    // it to the Electron app's context itself — without that, Electron pages
    // kept the library default of 30s (measured). Measured normal: bootTheme's
    // reload 0.1-0.25s locally (0.3-0.55s with the CI trace recording), the
    // first window's load ~0.35s.
    navigationTimeout: 20_000,
    // A trace of the first failing attempt, kept for CI only (#2458): the
    // failure worth a trace is the rare one that never reproduces locally.
    // Green attempts discard theirs; retries record none. Written under
    // test-results/, which ci.yml uploads with the JSON report.
    trace: process.env.CI ? 'retain-on-first-failure' : 'off',
  },
});
