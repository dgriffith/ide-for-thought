/**
 * Playwright config for the docs screenshot harness.
 *
 * This is NOT a pass/fail test suite — it drives the real Electron app against a
 * copy of the demo thoughtbase and writes PNGs into `website/docs/img/`. It's
 * kept separate from the e2e config (`playwright.config.ts` at the repo root) so
 * the smoke suite stays fast and this can run on demand:
 *
 *   pnpm build:e2e   # once, to (re)build the packaged app
 *   npx playwright test --config=website/screenshots/playwright.config.ts
 */
import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: '.',
  // One Electron instance at a time; captures share a single launched app.
  workers: 1,
  fullyParallel: false,
  // Generous — each shot boots or navigates the real app.
  timeout: 120_000,
  reporter: 'list',
  // No auto-retries: a flaky capture should be seen, not silently re-shot.
  retries: 0,
});
