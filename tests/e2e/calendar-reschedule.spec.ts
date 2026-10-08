/**
 * Rescheduling on the Calendar (#2703): on the stock Event view as a month
 * calendar, drag a multi-day event a week later with the pointer and both its
 * `date` and `end` move; move a timed event with the keyboard only (Enter on
 * its day → Shift+F10 → *Move to date…* → arrows → Enter) and its time is
 * kept; move a BOM + CRLF note by typing a date in the move bar; ⌘Z puts that
 * one back; and an event whose end is only a month refuses to drag, saying
 * why. Every file is checked byte for byte.
 *
 * Dates are built around the current month, because a view with no stored
 * `month` opens on it; every day used (5–20) exists in every month.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { seedNotes } from './helpers/timeline';
import { expectAnnounced, recordAnnouncements } from './helpers/announcements';
import { addMonth, dragEventToDay, openTypeCalendar, shownMonth, startMoveToDate, thisMonth, ymd } from './helpers/calendar';

const NOW = thisMonth();
const NEXT = addMonth(NOW, 1);

const offsite = (from: number, to: number) => `---\ntype: event\ndate: ${ymd(NOW, from)}\nend: "${ymd(NOW, to)}" # quoted, with a comment\nplace: Lakeside\n---\n# Offsite\n\nAgenda below.\n`;
const standup = (d: string) => `---\ntype: event\ndate: ${d}T09:30:15\n---\n# Standup\n`;
const kickoff = (d: string) => `\uFEFF---\r\ntype: event\r\ndate: ${d}\r\n---\r\n# Kickoff\r\n\r\nThe project starts.\r\n`;
const LAUNCH = `---\ntype: event\ndate: ${ymd(NOW, 20)}\nend: ${ymd(NEXT)}\n---\n# Launch\n`;

test('Calendar events reschedule by pointer drag, by keyboard and by a typed date; ⌘Z undoes; a month-only end refuses (#2703)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cal-move-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cal-move-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seedNotes(projectDir, {
    'events/Offsite.md': offsite(10, 12),
    'events/Standup.md': standup(ymd(NOW, 6)),
    'events/Kickoff.md': kickoff(ymd(NOW, 8)),
    'events/Launch.md': LAUNCH,
  });
  const file = (name: string) => path.join(projectDir, 'events', `${name}.md`);
  const read = (name: string) => fs.readFileSync(file(name), 'utf8');
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const cal = await test.step('open the Event view as a calendar', async () => {
      const c = await openTypeCalendar(win, 'Event');
      await recordAnnouncements(win);
      await expect(c.eventFor('Offsite').first()).toBeVisible();
      return c;
    });

    await test.step('pointer: drag the Offsite bar a week later; date and end both move', async () => {
      // Press on the bar inside its first day (the grab day), drop on the 17th.
      await dragEventToDay(win, cal, 'Offsite', NOW, 17, async () => {
        // The drop preview: the three days the event will cover.
        await expect(cal.grid.locator('[data-drop-target]')).toHaveCount(3);
      });

      await expect.poll(() => read('Offsite'), { timeout: 10_000 }).toBe(offsite(17, 19));
      await expect(cal.day(NOW.year, NOW.month, 17).locator('[data-calendar-event]')).toHaveCount(1, { timeout: 10_000 });
      await expect(cal.grid.locator('[data-drop-target]')).toHaveCount(0);
      await expect(win.locator('[data-calendar-ghost]')).toHaveCount(0);
      // A drop is not a click: the note did not open in a tab.
      await expect(win.locator('.tab', { hasText: 'Offsite' })).toHaveCount(0);
      await expectAnnounced(win, `Moved Offsite to`);
    });

    await test.step('keyboard only: Enter on the day → Shift+F10 → Move to date… → ↓ → Enter', async () => {
      await startMoveToDate(win, cal, NOW, 6, 'Standup.md');
      // Choosing a day: focus on the event's day, the move bar says what's happening.
      await expect(win.locator('[data-calendar-move-bar]')).toContainText('Moving Standup');
      await win.keyboard.press('ArrowDown');
      await expect(cal.day(NOW.year, NOW.month, 13)).toBeFocused();
      await win.keyboard.press('Enter');

      await expect.poll(() => read('Standup'), { timeout: 10_000 }).toBe(standup(ymd(NOW, 13)));
      await expect(cal.day(NOW.year, NOW.month, 13).locator('[data-calendar-event]')).toHaveCount(1, { timeout: 10_000 });
      await expect(win.locator('[data-calendar-move-bar]')).toHaveCount(0);
      await expectAnnounced(win, 'Moved Standup to');
    });

    await test.step('typed date: Kickoff (BOM + CRLF) to the 3rd of next month; the page follows', async () => {
      await startMoveToDate(win, cal, NOW, 8, 'Kickoff.md');
      await win.getByRole('textbox', { name: 'Date to move Kickoff to' }).fill(ymd(NEXT, 3));
      await win.keyboard.press('Enter');

      await expect.poll(() => read('Kickoff'), { timeout: 10_000 }).toBe(kickoff(ymd(NEXT, 3)));
      await expect.poll(() => shownMonth(win)).toBe(ymd(NEXT));
      await expect(cal.day(NEXT.year, NEXT.month, 3).locator('[data-calendar-event]')).toHaveCount(1, { timeout: 10_000 });
      await expect(cal.day(NEXT.year, NEXT.month, 3)).toBeFocused();
    });

    await test.step('⌘Z on the grid undoes the last move, byte for byte', async () => {
      await win.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => read('Kickoff'), { timeout: 10_000 }).toBe(kickoff(ymd(NOW, 8)));
      await expectAnnounced(win, 'Undid the move: Kickoff back to');
      // The earlier moves stay.
      expect(read('Standup')).toBe(standup(ymd(NOW, 13)));
      expect(read('Offsite')).toBe(offsite(17, 19));
    });

    await test.step('an event whose end is only a month refuses to drag, and says why', async () => {
      await win.getByRole('button', { name: 'Today' }).click();
      await expect.poll(() => shownMonth(win)).toBe(ymd(NOW));
      await expect(cal.eventFor('Launch').first()).toBeVisible({ timeout: 10_000 });
      await dragEventToDay(win, cal, 'Launch', NOW, 13, async () => {
        await expect(win.locator('[data-calendar-ghost]')).toHaveCount(0);
      });
      await expectAnnounced(win, `Launch ends ${ymd(NEXT)}, which has no day to move; open it to edit.`);
      expect(read('Launch')).toBe(LAUNCH);
      await expect(win.locator('.tab', { hasText: 'Launch' })).toHaveCount(0);
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
