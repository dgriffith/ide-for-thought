/**
 * A graph change leaves a Calendar's open day list alone.
 *
 * Since #2742 every write re-projects open views — including the calendar's
 * own moves and an autosave in another pane. The calendar read its `month`
 * prop straight from the host's derived spec object, which a refresh
 * rebuilds, so every refresh looked like a page turn: the day's list closed
 * under the user and focus fell to <body>. CI caught it as
 * calendar-reschedule's "keyboard only" step, which opens a list right after
 * a move's write lands.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { seedNotes } from './helpers/timeline';
import { openTypeCalendar, thisMonth, ymd } from './helpers/calendar';

const NOW = thisMonth();

test('a graph change while a day list is open keeps it open, with focus', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cal-refresh-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-cal-refresh-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seedNotes(projectDir, { 'events/Standup.md': `---\ntype: event\ndate: ${ymd(NOW, 6)}\n---\n# Standup\n` });
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const cal = await openTypeCalendar(win, 'Event');
    await cal.day(NOW.year, NOW.month, 6).focus();
    await win.keyboard.press('Enter');
    const event = cal.dayList.locator('[data-day-event][data-note-path$="Standup.md"]');
    await expect(event).toBeFocused();

    // An unrelated write: the graph changes, the view re-projects.
    await win.evaluate(() => (window as unknown as { api: { notebase: { writeFile(p: string, c: string): Promise<void> } } })
      .api.notebase.writeFile('Unrelated.md', '# Unrelated\n'));
    // Past the broadcast's coalescing window and the re-projection.
    await win.waitForTimeout(1_000);

    await expect(cal.dayList).toBeVisible();
    await expect(event).toBeFocused();
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
