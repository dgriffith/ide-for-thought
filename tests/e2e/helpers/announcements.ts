/**
 * Assert on what the app ANNOUNCED, not on what its live region holds now
 * (#2379).
 *
 * The app has one polite live region (`LiveAnnouncer.svelte`, #2374), and every
 * announcement replaces the last. Background work announces on its own
 * schedule — the proposal-arrival toast after a 300ms coalescing window, the
 * semantic index finishing — so `expect(region).toContainText(X)` is a race
 * against whatever announces next. Measured over 59 CI runs: 33 e2e flakes, each
 * a later announcement ("New proposal from e2e", "Semantic search index ready")
 * replacing the approve/reject announcement under test.
 *
 * `recordAnnouncements` keeps every text the region ever showed, so the
 * assertion is "this was spoken", which is what a screen-reader user cares
 * about and what the spec meant.
 */
import { expect, type Page } from '@playwright/test';

export const POLITE_REGION = '[data-testid="live-announcer-polite"]';

/** Start recording the polite region's text changes. Call after the workspace
 *  has booted (a reload discards the recorder) and before the action. */
export async function recordAnnouncements(win: Page): Promise<void> {
  await expect(win.locator(POLITE_REGION)).toHaveCount(1, { timeout: 10_000 });
  await win.evaluate((selector) => {
    const w = window as typeof window & { __announcements?: string[] };
    const region = document.querySelector(selector)!;
    const log: string[] = [];
    w.__announcements = log;
    new MutationObserver(() => {
      // trim() also drops the no-break space the announcer toggles onto a repeat.
      const text = (region.textContent ?? '').trim();
      if (text) log.push(text);
    }).observe(region, { childList: true, characterData: true, subtree: true });
  }, POLITE_REGION);
}

/** Every announcement since `recordAnnouncements`, oldest first. */
export async function announcements(win: Page): Promise<string[]> {
  return win.evaluate(() => (window as typeof window & { __announcements?: string[] }).__announcements ?? []);
}

/** Wait until some announcement since recording contains `text`. */
export async function expectAnnounced(win: Page, text: string, timeout = 5_000): Promise<void> {
  await expect
    .poll(async () => (await announcements(win)).some((a) => a.includes(text)), {
      message: `expected the polite live region to announce "${text}"`,
      timeout,
    })
    .toBe(true);
}
