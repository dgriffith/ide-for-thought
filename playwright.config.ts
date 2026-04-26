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
  // No HTML report on CI; failure output in stdout is enough.
  reporter: process.env.CI ? 'list' : 'list',
  use: {
    actionTimeout: 10_000,
  },
});
