/**
 * The Calendar journey (#2705, epic #2699), end to end in one flow: open
 * Events as a month calendar, page to next month and back, hover an event and
 * open it, come back and reschedule one event by pointer drag and another by
 * keyboard *Move to date…* (checking each file), save the calendar as a note
 * (checking its `object-view` fence carries the layout and the month), and
 * export that note through the real `publish.runExport`.
 *
 * `calendar-layout` checks the grid's pieces (the keyboard model, "+N more",
 * the `month` round-trip), `calendar-reschedule` the moves' edge cases (typed
 * dates, ⌘Z, refusals, BOM + CRLF) and `export-calendar` the export's
 * layout; this one checks they add up: the calendar paged and rescheduled in
 * its tab is the calendar that lands in a note and an export.
 *
 * The events cover what a month has to show: a single day, a timed event, a
 * multi-day bar, a Meeting (an Event subtype, #2612), a month-only date (the
 * month band), an undated note (the tray), and one next month, which the page
 * turn has to reach and the export of this month has to leave off.
 *
 * Dates are built around the current month, because a view with no stored
 * `month` opens on it; every day used (5–19) exists in every month.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { seedNotes } from './helpers/timeline';
import {
  addMonth, civilDay, dragEventToDay, openTypeCalendar, shownMonth, startMoveToDate, thisMonth, ymd,
} from './helpers/calendar';

const NOW = thisMonth();
const NEXT = addMonth(NOW, 1);

const offsite = (from: number, to: number) => `---\ntype: event\ndate: ${ymd(NOW, from)}\nend: ${ymd(NOW, to)}\n---\n# Offsite\n`;
const standup = (day: number) => `---\ntype: event\ndate: ${ymd(NOW, day)}T09:30\n---\n# Standup\n`;
const NOTES = {
  'events/Kickoff.md': `---\ntype: event\ndate: ${ymd(NOW, 5)}\n---\n# Kickoff\n\nThe project starts.\n`,
  'events/Standup.md': standup(6),
  'events/Offsite.md': offsite(10, 12),
  'meetings/Planning.md': `---\ntype: meeting\ndate: ${ymd(NOW, 15)}T14:00\n---\n# Planning\n`,
  'events/Harvest.md': `---\ntype: event\ndate: ${ymd(NOW)}\n---\n# Harvest\n`,
  'events/Someday.md': '---\ntype: event\n---\n# Someday\n',
  'events/Quarterly retro.md': `---\ntype: event\ndate: ${ymd(NEXT, 8)}\n---\n# Quarterly retro\n`,
};
/** Every event on this month's page: in the grid, the month band or the Undated tray. */
const THIS_MONTH = ['Kickoff', 'Standup', 'Offsite', 'Planning', 'Harvest', 'Someday'];

test('the Calendar journey: Events as a month, paged, opened, rescheduled by pointer and by keyboard, saved as a note, exported (#2705)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-calendar-journey-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-calendar-journey-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-calendar-journey-out-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seedNotes(projectDir, NOTES);
  const read = (rel: string) => fs.readFileSync(path.join(projectDir, rel), 'utf8');
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const preview = win.locator('.note-hover-preview');

    const cal = await test.step('open Events as a calendar: this month, a bar, a time, the band and the tray', async () => {
      const c = await openTypeCalendar(win, 'Event');
      expect(await shownMonth(win)).toBe(ymd(NOW));
      await expect(c.day(NOW.year, NOW.month, 5).locator('[data-calendar-event]')).toHaveCount(1);
      await expect(c.eventFor('Standup').locator('.cal-time')).toHaveText(/9:30/);
      await expect(c.eventFor('Offsite').first()).toHaveClass(/cal-bar/);
      await expect(c.eventFor('Planning')).toHaveCount(1); // a Meeting is an Event
      await expect(win.locator('[data-band="month"]')).toContainText('Harvest');
      await expect(win.locator('.cal-undated')).toContainText('Someday');
      await expect(c.eventFor('Quarterly retro')).toHaveCount(0);
      return c;
    });

    await test.step('page to next month and back', async () => {
      await win.getByRole('button', { name: 'Next month' }).click();
      await expect.poll(() => shownMonth(win)).toBe(ymd(NEXT));
      await expect(cal.day(NEXT.year, NEXT.month, 8).locator('[data-calendar-event]')).toHaveCount(1);
      await expect(cal.eventFor('Quarterly retro')).toHaveCount(1);
      await win.getByRole('button', { name: 'Previous month' }).click();
      await expect.poll(() => shownMonth(win)).toBe(ymd(NOW));
      await expect(cal.eventFor('Kickoff')).toHaveCount(1);
    });

    await test.step('hover Kickoff for its preview, open it, and come back', async () => {
      // The toolbar click leaves the pointer over the view: make sure no
      // earlier preview is still open before hovering for this one (#2719).
      await win.mouse.move(2, 2);
      await expect(preview).toHaveCount(0, { timeout: 5_000 });
      await cal.eventFor('Kickoff').hover();
      await expect(preview).toBeVisible({ timeout: 5_000 });
      await expect(preview.locator('.nhp-snippet:not(.nhp-loading)')).toContainText('The project starts.', { timeout: 5_000 });
      await cal.eventFor('Kickoff').click();
      await expect(win.locator('.tab.active')).toContainText('Kickoff', { timeout: 10_000 });
      await win.locator('.tab', { hasText: 'Event' }).first().click();
      await expect(cal.grid).toBeVisible({ timeout: 10_000 });
      expect(await shownMonth(win)).toBe(ymd(NOW));
    });

    await test.step('drag Offsite a week later: its date and end both move, in its file', async () => {
      await win.mouse.move(2, 2);
      await expect(preview).toHaveCount(0, { timeout: 5_000 });
      await dragEventToDay(win, cal, 'Offsite', NOW, 17, async () => {
        await expect(cal.grid.locator('[data-drop-target]')).toHaveCount(3);
      });
      await expect.poll(() => read('events/Offsite.md'), { timeout: 10_000 }).toBe(offsite(17, 19));
      await expect(cal.day(NOW.year, NOW.month, 17).locator('[data-calendar-event]')).toHaveCount(1, { timeout: 10_000 });
      await expect(win.locator('.tab', { hasText: 'Offsite' })).toHaveCount(0); // a drop is not a click
    });

    await test.step('keyboard: Standup to a week later through Move to date…, its time kept', async () => {
      await startMoveToDate(win, cal, NOW, 6, 'Standup.md');
      await expect(win.locator('[data-calendar-move-bar]')).toContainText('Moving Standup');
      await win.keyboard.press('ArrowDown');
      await expect(cal.day(NOW.year, NOW.month, 13)).toBeFocused();
      await win.keyboard.press('Enter');
      await expect.poll(() => read('events/Standup.md'), { timeout: 10_000 }).toBe(standup(13));
      await expect(cal.day(NOW.year, NOW.month, 13).locator('[data-calendar-event]')).toHaveCount(1, { timeout: 10_000 });
      await expect(win.locator('[data-calendar-move-bar]')).toHaveCount(0);
      // The first move stays.
      expect(read('events/Offsite.md')).toBe(offsite(17, 19));
    });

    const savedRel = 'Event calendar.md';
    await test.step('Save as note: the fence carries layout calendar and the month', async () => {
      await win.getByRole('button', { name: 'Save as note' }).click();
      await win.locator('input[aria-labelledby="prompt-dialog-title"]').press('Enter'); // accept the suggested name
      const saved = path.join(projectDir, savedRel);
      await expect.poll(() => fs.existsSync(saved), { timeout: 10_000 }).toBe(true);
      const spec = JSON.parse(/```object-view\n([\s\S]*?)\n```/.exec(fs.readFileSync(saved, 'utf-8'))![1]!) as Record<string, unknown>;
      // Paging back with Previous wrote the month; Event has one date
      // property, so there's no Date by choice to save.
      expect(spec).toMatchObject({ typeId: 'event', layout: 'calendar', month: ymd(NOW) });
      expect(spec).not.toHaveProperty('dateBy');
    });

    // Nothing below touches a preview: the saved note opens, but the export
    // renders the view itself, so there is no 120ms preview re-render (#2680)
    // to wait out.
    const html = await test.step('export the saved note through the real pipeline', async () => {
      const res = await win.evaluate(async ([dir, rel]) => (window as unknown as {
        api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
      }).api.publish.runExport({
        exporterId: 'note-html', input: { kind: 'single-note', relativePath: rel }, outputDir: dir, linkPolicy: 'inline-title',
      }), [outDir, savedRel] as const);
      const file = res!.writtenPaths.find((p) => p.endsWith('.html'))!;
      return fs.readFileSync(path.isAbsolute(file) ? file : path.join(outDir, file), 'utf-8');
    });
    for (const title of THIS_MONTH) expect(html, `${title} is in the export`).toContain(title);
    expect(html, 'the saved month is exported, not next month').not.toContain('Quarterly retro');
    expect(html, 'no raw spec in the export').not.toContain('&quot;typeId&quot;');
    expect(html, 'no raw spec in the export').not.toContain('"typeId"');
    expect(html, 'no object-view code block in the export').not.toMatch(/<code[^>]*object-view/);
    // The moved events are on their new days in the exported month.
    const dayOf = await win.evaluate((doc) => {
      const cells = new DOMParser().parseFromString(doc, 'text/html').querySelectorAll<HTMLElement>('[role="cell"]');
      const of = (title: string) => Array.from(cells).find((c) => Array.from(c.querySelectorAll('.calx-title')).some((t) => t.textContent === title))?.dataset['day'] ?? null;
      return { standup: of('Standup'), kickoff: of('Kickoff') };
    }, html);
    expect(Number(dayOf.standup), 'Standup is exported on its new day').toBe(civilDay(NOW.year, NOW.month, 13));
    expect(Number(dayOf.kickoff), 'Kickoff stays on its day').toBe(civilDay(NOW.year, NOW.month, 5));
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
