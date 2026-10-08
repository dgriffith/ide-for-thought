/**
 * The Calendar layout (#2702): open the stock Event view as a month calendar —
 * a single-day event, a timed one, a multi-day bar, a month-only date in the
 * month band, an undated note, and a day too full for its cell — then page
 * months, move by keyboard, open a day's list with Enter and with "+N more",
 * open an event from it, hover an event for the shared preview, and check the
 * page (`month`) round-trips when the layout is switched away and back.
 *
 * Dates are built around the current month, because a view with no stored
 * `month` opens on it.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Page } from '@playwright/test';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { seedNotes, type SeedNotes } from './helpers/timeline';
import { calendarOf, civilDay, openTypeCalendar, shownMonth, thisMonth, ymd } from './helpers/calendar';

const NOW = thisMonth();
const NEXT = NOW.month === 12 ? { year: NOW.year + 1, month: 1 } : { year: NOW.year, month: NOW.month + 1 };
const PREV = NOW.month === 1 ? { year: NOW.year - 1, month: 12 } : { year: NOW.year, month: NOW.month - 1 };
const BUSY_DAY = 20;
const BUSY = Array.from({ length: 8 }, (_, i) => `Busy ${i + 1}`);

const NOTES: SeedNotes = {
  'events/Kickoff.md': `---\ntype: event\ndate: ${ymd(NOW, 5)}\n---\n# Kickoff\n\nThe project starts.\n`,
  'events/Standup.md': `---\ntype: event\ndate: ${ymd(NOW, 6)}T09:00\n---\n# Standup\n`,
  'events/Offsite.md': `---\ntype: event\ndate: ${ymd(NOW, 10)}\nend: ${ymd(NOW, 13)}\n---\n# Offsite\n`,
  'events/Harvest.md': `---\ntype: event\ndate: ${ymd(NOW)}\n---\n# Harvest\n`,
  'events/Someday.md': '---\ntype: event\n---\n# Someday\n',
  ...Object.fromEntries(BUSY.map((t, i) => [`events/${t}.md`, `---\ntype: event\ndate: ${ymd(NOW, BUSY_DAY)}T${String(8 + i).padStart(2, '0')}:00\n---\n# ${t}\n`])),
};

/** The `data-day` of the focused cell, as a day of the month. */
async function focusedDayOfMonth(win: Page): Promise<number> {
  const ms = await win.evaluate(() => Number((document.activeElement as HTMLElement | null)?.dataset['day'] ?? NaN));
  return new Date(ms).getUTCDate();
}

test('an Event calendar: grid, paging, keyboard, the day\'s list, open, and `month` round-trips (#2702)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-calendar-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-calendar-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seedNotes(projectDir, NOTES);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const cal = await test.step('open the Event view as a calendar', () => openTypeCalendar(win, 'Event'));

    await test.step('this month, its events, the month band and the Undated tray', async () => {
      expect(await shownMonth(win)).toBe(ymd(NOW));
      await expect(cal.eventFor('Kickoff')).toHaveCount(1);
      await expect(cal.day(NOW.year, NOW.month, 5).locator('[data-calendar-event]')).toHaveCount(1);
      await expect(cal.eventFor('Standup').locator('.cal-time')).toHaveText(/9:00/);
      const offsite = cal.eventFor('Offsite');
      expect(await offsite.count()).toBeGreaterThanOrEqual(1); // one segment per week row it crosses
      await expect(offsite.first()).toHaveClass(/cal-bar/);
      await expect(win.locator('[data-band="month"]')).toContainText('Harvest');
      await expect(win.locator('.cal-undated')).toContainText('Someday');
      await expect(cal.day(NOW.year, NOW.month, BUSY_DAY).locator('.cal-more')).toHaveText(/^\+\d+ more$/);
      await expect(cal.tabStop).toHaveCount(1);
    });

    await test.step('page months with the toolbar', async () => {
      await win.getByRole('button', { name: 'Next month' }).click();
      await expect.poll(() => shownMonth(win)).toBe(ymd(NEXT));
      await win.getByRole('button', { name: 'Previous month' }).click();
      await win.getByRole('button', { name: 'Previous month' }).click();
      await expect.poll(() => shownMonth(win)).toBe(ymd(PREV));
      await win.getByRole('button', { name: 'Today' }).click();
      await expect.poll(() => shownMonth(win)).toBe(ymd(NOW));
    });

    await test.step('navigate by keyboard: one tab stop, arrows, Page Down/Up, Home/End', async () => {
      await win.getByRole('button', { name: 'Next month' }).focus();
      await win.keyboard.press('Tab');
      await expect(cal.tabStop).toBeFocused();
      // Walk to the busy day with the arrows (no page turn inside the month).
      for (let i = 0; i < 31; i++) {
        const d = await focusedDayOfMonth(win);
        if (d === BUSY_DAY) break;
        await win.keyboard.press(d < BUSY_DAY ? 'ArrowRight' : 'ArrowLeft');
      }
      await expect(cal.day(NOW.year, NOW.month, BUSY_DAY)).toBeFocused();
      await win.keyboard.press('ArrowUp');
      await expect(cal.day(NOW.year, NOW.month, BUSY_DAY - 7)).toBeFocused();
      await win.keyboard.press('ArrowDown');
      await expect(cal.day(NOW.year, NOW.month, BUSY_DAY)).toBeFocused();
      await win.keyboard.press('PageDown');
      await expect.poll(() => shownMonth(win)).toBe(ymd(NEXT));
      await expect(cal.day(NEXT.year, NEXT.month, BUSY_DAY)).toBeFocused();
      await win.keyboard.press('PageUp');
      await expect.poll(() => shownMonth(win)).toBe(ymd(NOW));
      await expect(cal.day(NOW.year, NOW.month, BUSY_DAY)).toBeFocused();
      await win.keyboard.press('Home');
      const home = await focusedDayOfMonth(win);
      await win.keyboard.press('End');
      expect(await focusedDayOfMonth(win)).toBe(home + 6);
      await win.keyboard.press('Home');
      for (let d = home; d < BUSY_DAY; d++) await win.keyboard.press('ArrowRight');
      await expect(cal.day(NOW.year, NOW.month, BUSY_DAY)).toBeFocused();
    });

    await test.step('Enter opens the day\'s list; ↓ moves and shows the preview; Escape returns to the day', async () => {
      await win.keyboard.press('Enter');
      await expect(cal.dayList).toBeVisible();
      const items = cal.dayList.locator('[data-day-event]');
      await expect(items).toHaveCount(BUSY.length);
      await expect(items.first()).toBeFocused();
      await win.keyboard.press('ArrowDown');
      await expect(items.nth(1)).toBeFocused();
      await expect(win.getByRole('tooltip')).toContainText('Busy 2');
      await win.keyboard.press('Escape'); // closes the preview
      await expect(win.locator('.note-hover-preview')).toHaveCount(0);
      if (await cal.dayList.count()) await win.keyboard.press('Escape');
      await expect(cal.dayList).toHaveCount(0);
      await expect(cal.day(NOW.year, NOW.month, BUSY_DAY)).toBeFocused();
    });

    await test.step('hover an event for the shared preview', async () => {
      await win.mouse.move(2, 2);
      await expect(win.locator('.note-hover-preview')).toHaveCount(0, { timeout: 5_000 });
      await cal.eventFor('Kickoff').hover();
      const tip = win.locator('.note-hover-preview');
      await expect(tip).toBeVisible({ timeout: 5_000 });
      await expect(tip.locator('.nhp-snippet:not(.nhp-loading)')).toContainText('The project starts.', { timeout: 5_000 });
      await win.mouse.move(2, 2);
      await expect(tip).toHaveCount(0, { timeout: 5_000 });
    });

    await test.step('"+N more" opens the list; an event in it opens its note', async () => {
      await cal.day(NOW.year, NOW.month, BUSY_DAY).locator('.cal-more').click();
      await expect(cal.dayList).toBeVisible();
      await cal.dayList.locator('[data-day-event]', { hasText: 'Busy 8' }).click();
      await expect(win.locator('.tab.active')).toContainText('Busy 8', { timeout: 10_000 });
    });

    await test.step('`month` round-trips: page, switch the layout away and back', async () => {
      await win.locator('.tab', { hasText: 'Event' }).first().click();
      await expect(cal.grid).toBeVisible({ timeout: 10_000 });
      await win.getByRole('button', { name: 'Next month' }).click();
      await expect.poll(() => shownMonth(win)).toBe(ymd(NEXT));
      await win.getByRole('tab', { name: 'List' }).click();
      await expect(cal.grid).toHaveCount(0);
      await win.getByRole('tab', { name: 'Calendar' }).click();
      await expect(cal.grid).toBeVisible({ timeout: 10_000 });
      expect(await shownMonth(win)).toBe(ymd(NEXT));
      await win.getByRole('tab', { name: 'Timeline' }).click();
      await expect(win.locator('.tl-plot')).toBeVisible({ timeout: 10_000 });
      await win.getByRole('tab', { name: 'Calendar' }).click();
      await expect(cal.grid).toBeVisible({ timeout: 10_000 });
      expect(await shownMonth(win)).toBe(ymd(NEXT));
      // The page's day cells are the next month's.
      await expect(calendarOf(win).grid.locator(`[data-day="${civilDay(NEXT.year, NEXT.month, 1)}"]`)).toHaveCount(1);
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
