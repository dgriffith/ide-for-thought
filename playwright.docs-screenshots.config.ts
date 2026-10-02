/**
 * Playwright config for capturing the user docs' screenshots — run with
 * `pnpm docs:screenshots` after `pnpm build:e2e`. Not part of the CI e2e job:
 * it writes `website/docs/img/*.png` rather than asserting anything, and the
 * map shot loads real map tiles over the network.
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests/docs-screenshots',
  workers: 1,
  timeout: 180_000,
  retries: 0,
  reporter: [['list']],
  use: { actionTimeout: 15_000, navigationTimeout: 20_000 },
});
