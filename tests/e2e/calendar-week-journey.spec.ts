/**
 * The Week and Day journey (#2955, epic #2949): on the Event calendar, switch
 * to Week; move a timed event by keyboard and resize it, each written to its
 * file; open one day in Day by double-clicking its number; come back to
 * Week, save it as a note (the fence keeps `mode`), and export that note
 * through the real pipeline: a week exports as an agenda — seven days, each
 * event with its time — not the month grid. The pointer drags are
 * `calendar-week-retime.spec.ts`'s.
 *
 * The events are today, so Week (from a month following today) opens on
 * their week and saves no `date`.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { seedNotes } from './helpers/timeline';
import { expectAnnounced, recordAnnouncements } from './helpers/announcements';
import { calendarOf, openTypeCalendar, thisMonth, ymd } from './helpers/calendar';

const NOW = thisMonth();
const TODAY = ymd(NOW, new Date().getDate());
const review = (start: string, end: string) => `---\ntype: event\ndate: ${TODAY}T${start}\nend: ${TODAY}T${end}\n---\n# Review\n`;

test('Week and Day: move and resize by keyboard, open a day, save the week, export it as an agenda (#2955)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cal-week-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cal-week-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cal-week-export-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seedNotes(projectDir, {
    'events/Review.md': review('09:00', '10:00'),
    'events/Holiday.md': `---\ntype: event\ndate: ${TODAY}\n---\n# Holiday\n`,
  });
  const read = () => fs.readFileSync(path.join(projectDir, 'events', 'Review.md'), 'utf8');
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await openTypeCalendar(win, 'Event');
    await recordAnnouncements(win);
    const frame = calendarOf(win).frame;
    const modes = frame.getByRole('group', { name: 'Calendar view' });
    const event = frame.locator('.wk-ev[data-note-path$="Review.md"]');

    await test.step('switch to Week: today\'s events in their week', async () => {
      await modes.getByRole('button', { name: 'Week' }).click();
      await expect(modes.getByRole('button', { name: 'Week' })).toHaveAttribute('aria-pressed', 'true');
      await expect(event).toHaveAttribute('data-start-min', '540', { timeout: 10_000 });
      await expect(frame.locator('.wk-bar[data-note-path$="Holiday.md"]')).toBeVisible();
    });

    await test.step('Alt+↓ moves it 15 minutes; Alt+Shift+↓ moves its end', async () => {
      await event.focus();
      await win.keyboard.press('Alt+ArrowDown');
      await expect.poll(read, { timeout: 10_000 }).toBe(review('09:15', '10:15'));
      await expectAnnounced(win, 'Moved Review to');
      await expect(event).toBeFocused({ timeout: 10_000 });
      await win.keyboard.press('Alt+Shift+ArrowDown');
      await expect.poll(read, { timeout: 10_000 }).toBe(review('09:15', '10:30'));
      await expectAnnounced(win, 'Review now ends at');
    });

    await test.step('double-click today\'s number: that day, in Day, with its agenda', async () => {
      await frame.locator('.wk-colhead.wk-today .wk-num').dblclick();
      await expect(modes.getByRole('button', { name: 'Day' })).toHaveAttribute('aria-pressed', 'true');
      await expect(frame.locator('.wk')).toHaveCSS('--cols', '1');
      await expect(frame.locator('[data-calendar-agenda] [data-agenda-event]')).toHaveCount(2);
    });

    const savedRel = 'Event calendar.md';
    await test.step('back to Week, and Save as note: the fence keeps the week', async () => {
      await modes.getByRole('button', { name: 'Week' }).click();
      await expect(frame.locator('.wk')).toHaveCSS('--cols', '7');
      await win.getByRole('button', { name: 'Save as note' }).click();
      await win.locator('input[aria-labelledby="prompt-dialog-title"]').press('Enter'); // accept the suggested name
      const saved = path.join(projectDir, savedRel);
      const fence = /```object-view\n([\s\S]*?)\n```/;
      await expect.poll(() => (fs.existsSync(saved) ? fence.exec(fs.readFileSync(saved, 'utf-8'))?.[1] ?? null : null), { timeout: 10_000 }).not.toBeNull();
      const spec = JSON.parse(fence.exec(fs.readFileSync(saved, 'utf-8'))![1]!) as Record<string, unknown>;
      expect(spec).toMatchObject({ typeId: 'event', layout: 'calendar', mode: 'week' });
    });

    await test.step('export the saved week: an agenda of seven days, the event with its time', async () => {
      const res = await win.evaluate(async ([dir, rel]) => (window as unknown as {
        api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
      }).api.publish.runExport({
        exporterId: 'note-html', input: { kind: 'single-note', relativePath: rel }, outputDir: dir, linkPolicy: 'inline-title',
      }), [outDir, savedRel] as const);
      const file = res!.writtenPaths.find((p) => p.endsWith('.html'))!;
      const html = fs.readFileSync(path.isAbsolute(file) ? file : path.join(outDir, file), 'utf-8');
      const agenda = await win.evaluate((doc) => {
        const d = new DOMParser().parseFromString(doc, 'text/html');
        return {
          days: d.querySelectorAll('.cala-day').length,
          grid: d.querySelectorAll('[role="table"]').length,
          lines: Array.from(d.querySelectorAll('.cala-entry')).map((e) => (e.textContent ?? '').replace(/\s+/g, ' ').trim()),
        };
      }, html);
      expect(agenda.days, 'a week is seven days').toBe(7);
      expect(agenda.grid, 'no month grid').toBe(0);
      expect(agenda.lines[0], 'all-day first').toMatch(/^All day Holiday/);
      expect(agenda.lines[1], 'then by time, the moved and resized times').toMatch(/^9:15.*10:30.* Review$/i);
      expect(html, 'no raw spec in the export').not.toContain('"typeId"');
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
