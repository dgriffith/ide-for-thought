/**
 * Moving by time in the Calendar's Week view (#2953): drag a timed event an
 * hour later and its `date` and `end` both move by an hour; drag its bottom
 * edge and only `end` moves; Alt+↓ moves it 15 minutes from the keyboard;
 * ⌘Z (Ctrl+Z off macOS) takes the last one back. Every file is checked byte
 * for byte, so the comment and the rest of the note are kept.
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
import { calendarOf, openTypeCalendar, thisMonth, ymd } from './helpers/calendar';

const NOW = thisMonth();
const TODAY = ymd(NOW, new Date().getDate());
const review = (start: string, end: string) => `---\ntype: event\ndate: ${TODAY}T${start}\nend: ${TODAY}T${end} # keep\n---\n# Review\n\nAgenda.\n`;

test('Week: drag a timed event an hour later, resize it, nudge it by keyboard, and undo (#2953)', async () => {
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
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
