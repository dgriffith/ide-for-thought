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
import { expect, type Locator, type Page } from '@playwright/test';

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
