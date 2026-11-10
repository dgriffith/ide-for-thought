/**
 * Hover until something appears (#2719).
 *
 * A single `locator.hover()` is one synthetic pointer move. Under load it
 * sometimes doesn't take: in the failures captured for #2719 the document's
 * `:hover` chain was EMPTY — not the link, not even `<html>` — and no tooltip
 * existed, i.e. the page had lost the pointer entirely between the move and
 * the 250ms hover delay (the window seeing a real pointer exit). Waiting longer
 * can't help then; nothing is pending. Moving again does: a fresh move inside
 * the target re-enters it and restarts the delay.
 *
 * So: move onto the target's centre and nudge a pixel (two moves, both inside
 * it), wait briefly for `shown`, and repeat within one overall window. Each
 * attempt is a real hover — the delay still has to elapse with the pointer at
 * rest, so this proves the same thing a single hover would.
 */
import { expect, type ElectronApplication, type Locator, type Page } from '@playwright/test';

export async function hoverUntil(
  win: Page,
  target: Locator,
  shown: Locator,
  opts: { timeout?: number; perAttempt?: number } = {},
): Promise<void> {
  const { timeout = 15_000, perAttempt = 2_500 } = opts;
  await expect(async () => {
    await target.scrollIntoViewIfNeeded();
    const box = await target.boundingBox();
    if (!box) throw new Error('hover target has no box');
    const x = box.x + box.width / 2;
    const y = box.y + box.height / 2;
    await win.mouse.move(x, y);
    await win.mouse.move(x + 1, y);
    await expect(shown).toBeVisible({ timeout: perAttempt });
  }).toPass({ timeout, intervals: [0] });
}

/**
 * Focus until something appears (#3047).
 *
 * A plugin's view is an out-of-process frame, and Playwright's focus emulation
 * covers the page, not that frame: the frame fires `focus` and `blur` only as
 * the window really gains and loses the OS focus. A window that doesn't have
 * it, because the previous app's quit or another window took it, leaves the
 * card the frame's active element with no `focus` event, so nothing asks for
 * its preview. Or it fires `focus` and then `blur` as the focus goes, and the
 * preview goes with it. Captured: the host's `document.hasFocus()` true (emulated)
 * and its active element the frame, the frame's own `false`, and no tooltip.
 *
 * So each attempt brings the window to the front, focuses the target afresh
 * (blur first, so `focus` fires even if it was already the active element), and
 * waits briefly for `shown`. Each attempt is a real keyboard focus; what it
 * proves is the same.
 */
export async function focusUntil(
  app: ElectronApplication,
  target: Locator,
  shown: Locator,
  opts: { timeout?: number; perAttempt?: number } = {},
): Promise<void> {
  const { timeout = 15_000, perAttempt = 2_500 } = opts;
  await expect(async () => {
    await app.evaluate(({ app: a, BrowserWindow }) => {
      a.focus({ steal: true });
      BrowserWindow.getAllWindows()[0]?.focus();
    });
    await target.evaluate((el) => (el as HTMLElement).blur());
    await target.focus();
    await expect(shown).toBeVisible({ timeout: perAttempt });
  }).toPass({ timeout, intervals: [0] });
}
