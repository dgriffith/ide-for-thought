/**
 * Marketing screenshot — the first-run onboarding wizard on getting-started.html
 * (#1409).
 *
 * Its own file because it needs its own launch: the wizard only appears when a
 * thoughtbase with zero notes is opened, so `launchEmpty()` boots a fresh empty
 * one instead of the demo vault every other capture uses.
 *
 * A still, not a screencast. The placeholder hopes for "the wizard flow, then
 * the generated overview notes appearing", but the second half is a live-model
 * conversation drafting notes — not something the harness can produce
 * deterministically. The filled-in wizard is the part that answers "what do I
 * even do first".
 *
 * Run:
 *   npx playwright test --config=website/screenshots/playwright.config.ts capture-onboarding.spec.ts
 *   node website/screenshots/swap-marketing-shots.mjs
 */
import { test } from '@playwright/test';
import { launchEmpty, MARKETING_IMG_DIR, ONBOARDING_DIALOG, shoot, type Harness } from './lib/harness';

let h: Harness;

test.beforeAll(async () => {
  h = await launchEmpty();
});

test.afterAll(async () => {
  await h?.app.close().catch(() => { /* already exited */ });
  h?.cleanup();
});

test('onboarding', async () => {
  const wizard = h.win.locator(ONBOARDING_DIALOG);
  // Filled in the way a new user would — a subject and what it's for — so the
  // shot reads as a real first step rather than an empty form. Expertise and
  // depth keep their defaults (familiar / moderate).
  await wizard.locator('#onb-subject').fill('the mandolin and its family of instruments');
  await wizard.locator('#onb-use').fill('a history talk for our mandolin orchestra');
  // Park the caret away from the fields so no focus ring or blinking cursor
  // lands in the frame.
  await h.win.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await h.win.waitForTimeout(400);
  await shoot(h.win, 'onboarding', undefined, MARKETING_IMG_DIR);
});
