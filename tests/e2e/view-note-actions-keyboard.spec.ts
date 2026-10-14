/**
 * The note-actions menu from the keyboard (#2776, epic #2769): in the type
 * view's panel and in a note's embedded view, focus a card or row, press
 * Shift+F10, arrow to Add Tag…, type the tag — no pointer for any of it — and
 * the note is tagged and the change is announced.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { expectAnnounced, recordAnnouncements } from './helpers/announcements';
import { openProjectBoard, seedProjects, type SeedProject } from './helpers/kanban';

const PROJECTS: SeedProject[] = [
  ['Garden Shed', 'active'],
  ['Novel Draft', 'active'],
  ['Tax Return', 'done'],
];

test('tag a note from a view\'s menu without a pointer, in the panel and in an embed (#2776)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-note-actions-kbd-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-note-actions-kbd-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  const fileOf = seedProjects(projectDir, PROJECTS);
  fs.writeFileSync(path.join(projectDir, 'Projects Table.md'),
    ['# Projects', '', '```object-view', JSON.stringify({ typeId: 'project', layout: 'table' }), '```', ''].join('\n'));
  const tagsOf = (title: string) => fs.readFileSync(fileOf(title), 'utf8');
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await recordAnnouncements(win);
    const promptInput = win.locator('input[aria-labelledby="prompt-dialog-title"]');

    await test.step('the panel: a focused card, Shift+F10, Add Tag…', async () => {
      const kb = await openProjectBoard(win, PROJECTS.length);
      await kb.cardFor('Garden Shed').focus();
      await win.keyboard.press('Shift+F10');
      await expect(win.getByRole('menu')).toBeVisible();
      // Move to ▸ comes first on a board; Add Tag… is next.
      await win.keyboard.press('ArrowDown');
      await expect(win.getByRole('menuitem', { name: /^Add Tag/ })).toBeFocused();
      await win.keyboard.press('Enter');
      await expect(promptInput).toBeFocused();
      await win.keyboard.type('from-keyboard');
      await win.keyboard.press('Enter');
      await expect.poll(() => tagsOf('Garden Shed')).toContain('from-keyboard');
      await expectAnnounced(win, 'Tagged 1 of 1 note with "from-keyboard".');
    });

    await test.step('an embed: a focused row, Shift+F10, Add Tag… — for that row only', async () => {
      await win.locator('.panel-tab[title="Notes"]').first().click();
      await win.locator('[data-relative-path="Projects Table.md"]').first().click();
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'view.togglePreview'); });
      const row = win.locator('.preview .object-view-block tr', { hasText: 'Novel Draft' });
      await expect(row).toHaveAttribute('tabindex', '0', { timeout: 15_000 });
      await row.focus();
      await win.keyboard.press('Shift+F10');
      await expect(win.getByRole('menuitem', { name: /^Add Tag/ })).toBeFocused(); // no Move to in an embed
      await win.keyboard.press('Enter');
      await expect(promptInput).toBeFocused();
      await win.keyboard.type('in-an-embed');
      await win.keyboard.press('Enter');
      await expect.poll(() => tagsOf('Novel Draft')).toContain('in-an-embed');
      expect(tagsOf('Tax Return')).not.toContain('in-an-embed');
      await expectAnnounced(win, 'Tagged 1 of 1 note with "in-an-embed".');
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
