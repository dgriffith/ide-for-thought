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
  },
});
