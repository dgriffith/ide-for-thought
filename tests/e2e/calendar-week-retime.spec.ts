/**
 * Moving by time in the Calendar's Week view (#2953): drag a timed event an
 * hour later and its `date` and `end` both move by an hour; drag its bottom
 * edge and only `end` moves; Alt+↓ moves it 15 minutes from the keyboard;
 * ⌘Z (Ctrl+Z off macOS) takes the last one back. Every file is checked byte
 * for byte, so the comment and the rest of the note are kept. Then (#2954)
 * drag out an empty hour, choose Event over its Meeting subtype, name it,
 * and find the new note dated to that hour.
 *
 * The event is today, so the Week button (from a month following today)
 * opens on its week.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { seedNotes } from './helpers/timeline';
import { expectAnnounced, recordAnnouncements } from './helpers/announcements';
import { calendarOf, civilDay, openTypeCalendar, thisMonth, ymd } from './helpers/calendar';

const NOW = thisMonth();
const TODAY = ymd(NOW, new Date().getDate());
const review = (start: string, end: string) => `---\ntype: event\ndate: ${TODAY}T${start}\nend: ${TODAY}T${end} # keep\n---\n# Review\n\nAgenda.\n`;

test('Week: drag a timed event an hour later, resize it, nudge it by keyboard, and undo (#2953); drag out a new one (#2954)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cal-retime-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cal-retime-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seedNotes(projectDir, { 'events/Review.md': review('09:00', '10:00') });
  const read = () => fs.readFileSync(path.join(projectDir, 'events', 'Review.md'), 'utf8');
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await openTypeCalendar(win, 'Event');
    await recordAnnouncements(win);
    const frame = calendarOf(win).frame;
    await frame.getByRole('group', { name: 'Calendar view' }).getByRole('button', { name: 'Week' }).click();
    const event = frame.locator('.wk-ev[data-note-path$="Review.md"]');
    await expect(event).toBeVisible({ timeout: 10_000 });

    await test.step('drag its body an hour later: date and end both move', async () => {
      const box = (await event.boundingBox())!;
      const hour = box.height; // an hour-long event is an hour tall
      await win.mouse.move(box.x + box.width / 2, box.y + hour / 2);
      await win.mouse.down();
      await win.mouse.move(box.x + box.width / 2, box.y + hour / 2 + hour, { steps: 12 });
      // A preview while held: where it lands. Its exact time isn't asserted — pointer moves reach the
      // plugin's frame per painted frame, so mid-drag it can trail the pointer; the drop reads the release.
      await expect(event).toHaveAttribute('data-dragging', 'move');
      await expect(event).toHaveAttribute('data-drop-time', /\d/);
      await win.mouse.up();
      await expect.poll(read, { timeout: 10_000 }).toBe(review('10:00', '11:00'));
      await expect(event).toHaveAttribute('data-start-min', '600', { timeout: 10_000 });
      await expectAnnounced(win, 'Moved Review to');
      // A drop is not a click: the note did not open.
      await expect(win.locator('.tab', { hasText: 'Review' })).toHaveCount(0);
    });

    await test.step('drag its bottom edge half an hour down: only the end moves', async () => {
      const box = (await event.boundingBox())!;
      const half = box.height / 2;
      await win.mouse.move(box.x + box.width / 2, box.y + box.height - 2);
      await win.mouse.down();
      await win.mouse.move(box.x + box.width / 2, box.y + box.height - 2 + half, { steps: 12 });
      await win.mouse.up();
      await expect.poll(read, { timeout: 10_000 }).toBe(review('10:00', '11:30'));
      await expectAnnounced(win, 'Review now ends at');
    });

    await test.step('Alt+↓ on the focused event moves it 15 minutes; ⌘Z takes that back', async () => {
      await event.focus();
      await win.keyboard.press('Alt+ArrowDown');
      await expect.poll(read, { timeout: 10_000 }).toBe(review('10:15', '11:45'));
      await expect(event).toBeFocused({ timeout: 10_000 });
      await win.keyboard.press('ControlOrMeta+z');
      await expect.poll(read, { timeout: 10_000 }).toBe(review('10:00', '11:30'));
    });

    await test.step('drag out an empty hour: choose the type, name it, and it is a note dated to that hour (#2954)', async () => {
      const today = civilDay(NOW.year, NOW.month, new Date().getDate());
      const slot = (n: number) => frame.locator(`[role="gridcell"][data-day="${today}"][data-slot="${n}"]`);
      await slot(28).scrollIntoViewIfNeeded();
      const from = (await slot(28).boundingBox())!;
      const to = (await slot(29).boundingBox())!;
      await win.mouse.move(from.x + from.width / 2, from.y + 1);
      await win.mouse.down();
      await win.mouse.move(to.x + to.width / 2, to.y + to.height - 1, { steps: 10 });
      await win.mouse.up();
      // Event has a stock subtype (Meeting), so Minerva asks which.
      await win.getByRole('option').filter({ has: win.locator('.tp-name', { hasText: /^Event$/ }) }).click();
      const title = win.locator('input[aria-labelledby="prompt-dialog-title"]');
      await title.fill('Planning');
      await title.press('Enter');
      const created = path.join(projectDir, 'Planning.md');
      await expect.poll(() => fs.existsSync(created), { timeout: 10_000 }).toBe(true);
      const text = fs.readFileSync(created, 'utf8');
      expect(text).toMatch(/^---\ntype: event\n/);
      expect(text).toContain(`\ndate: ${TODAY}T14:00\n`);
      expect(text).toContain(`\nend: ${TODAY}T15:00\n`);
      await expect(frame.locator('.wk-ev[data-note-path="Planning.md"]')).toHaveAttribute('data-start-min', '840', { timeout: 10_000 });
      await expectAnnounced(win, 'Created Planning.');
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
