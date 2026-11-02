/**
 * The note menu on a Timeline event (#2928): in a note's embedded timeline,
 * right-click an event — drawn inside the Timeline plugin's frame — and
 * Minerva's own menu opens for that note; Add Tag… tags it, and only it.
 * Then the same from the keyboard: the focused event, Shift+F10.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { expectAnnounced, recordAnnouncements } from './helpers/announcements';
import { seedNotes, timelineOf, type SeedNotes } from './helpers/timeline';

const NOTES: SeedNotes = {
  'events/Apollo 11.md': '---\ntype: event\ndate: 1969-07-16\nend: 1969-07-24\n---\n# Apollo 11\n',
  'events/Moon landing.md': '---\ntype: event\ndate: 1969-07-20\n---\n# Moon landing\n',
  'Sixties.md': ['# Sixties', '', '```object-view', JSON.stringify({ typeId: 'event', layout: 'timeline' }), '```', ''].join('\n'),
};

test("right-click an event in an embedded timeline for Minerva's note menu, and tag it (#2928)", async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-timeline-menu-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-timeline-menu-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seedNotes(projectDir, NOTES);
  const read = (title: string) => fs.readFileSync(path.join(projectDir, 'events', `${title}.md`), 'utf8');
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await recordAnnouncements(win);
    const promptInput = win.locator('input[aria-labelledby="prompt-dialog-title"]');

    await win.locator('.panel-tab[title="Notes"]').first().click();
    await win.locator('[data-relative-path="Sixties.md"]').first().click();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'view.togglePreview'); });
    const tl = timelineOf(win);
    await expect(tl.events).toHaveCount(2, { timeout: 15_000 });

    await test.step('right-click an event: the menu for that note; Add Tag… tags it alone', async () => {
      // Its mark: the `<g>`'s box is mostly empty plot, and a label takes no pointer.
      await tl.eventFor('Moon landing').locator('.tl-point, .tl-bar').first().click({ button: 'right' });
      await expect(win.getByRole('menuitem', { name: /^Add Tag/ })).toBeFocused();
      await win.keyboard.press('Enter');
      await expect(promptInput).toBeFocused();
      await win.keyboard.type('from-the-timeline');
      await win.keyboard.press('Enter');
      await expect.poll(() => read('Moon landing')).toContain('from-the-timeline');
      expect(read('Apollo 11')).not.toContain('from-the-timeline');
      await expectAnnounced(win, 'Tagged 1 of 1 note with "from-the-timeline".');
      // The embed redraws from the change, the frame still there.
      await expect(tl.events).toHaveCount(2);
    });

    await test.step('the keyboard: the focused event, Shift+F10', async () => {
      await tl.eventFor('Apollo 11').focus();
      await win.keyboard.press('Shift+F10');
      await expect(win.getByRole('menuitem', { name: /^Add Tag/ })).toBeFocused();
      await win.keyboard.press('Escape');
      await expect(win.getByRole('menu')).toHaveCount(0);
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
