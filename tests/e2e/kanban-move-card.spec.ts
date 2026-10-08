/**
 * Moving a Kanban card (#2603): on the stock Project board, drag a project
 * from *active* to *done* with the pointer and the file says `status: done`;
 * then move another the same way with the keyboard only (Shift+F10 → Move to
 * → done), with focus staying on the moved card; then ⌘Z on the board puts
 * it back. Every other byte of each note is untouched.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { expectAnnounced, recordAnnouncements } from './helpers/announcements';
import { focusLastLayoutTab, dragCardToColumn, openProjectBoard, seedProjects } from './helpers/kanban';

const noteText = (title: string, status: string | null) =>
  `---\ntype: project\nstatus: ${status}\nowner: Ann  # keep this comment\n---\n# ${title}\n\nBody text.\n`;

test('a Project card moves between columns by pointer drag and by keyboard, and writes status (#2603)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-kanban-move-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-kanban-move-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  const fileOf = seedProjects(projectDir, [['Garden Shed', 'active'], ['Novel Draft', 'active'], ['Tax Return', 'done']], noteText);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const statusOf = (title: string) => /^status: (.*)$/m.exec(fs.readFileSync(fileOf(title), 'utf8'))?.[1];

    const kb = await test.step('open the Project view as a board', async () => {
      const b = await openProjectBoard(win, 3);
      await recordAnnouncements(win);
      return b;
    });
    const { board, cardFor, inColumn } = kb;

    await test.step('pointer: drag Garden Shed from active onto done', async () => {
      await dragCardToColumn(win, kb, 'Garden Shed', 'done', async () => {
        // The column under the pointer is marked as the drop target.
        await expect(board.locator('section.kb-column[data-drop-target]')).toHaveAttribute('data-column-value', 'done');
      });

      await expect.poll(() => statusOf('Garden Shed'), { timeout: 10_000 }).toBe('done');
      expect(fs.readFileSync(fileOf('Garden Shed'), 'utf8')).toBe(noteText('Garden Shed', 'done'));
      await expect(inColumn('done', 'Garden Shed')).toHaveCount(1, { timeout: 10_000 });
      await expect(board.locator('section.kb-column[data-drop-target]')).toHaveCount(0);
      // A drop is not a click: the note did not open in a tab.
      await expect(win.locator('.tab', { hasText: 'Garden Shed' })).toHaveCount(0);
      await expectAnnounced(win, 'Moved Garden Shed to done.');
    });

    await test.step('keyboard only: Shift+F10 → Move to → done, focus stays on the card', async () => {
      await focusLastLayoutTab(win);
      await win.keyboard.press('Tab');
      // The tab stop is still the card just dragged, now in done.
      await expect(inColumn('done', 'Garden Shed')).toBeFocused();
      await win.keyboard.press('ArrowLeft'); // paused is empty: active
      await expect(cardFor('Novel Draft')).toBeFocused();
      await win.keyboard.press('Shift+F10');
      await expect(win.getByRole('menuitem', { name: 'Move to' })).toBeFocused();
      await win.keyboard.press('ArrowRight');
      // active is where it already is (disabled), so focus starts at paused.
      await expect(win.getByRole('menu', { name: 'Move to' }).getByRole('menuitem', { name: 'paused' })).toBeFocused();
      await win.keyboard.press('ArrowDown');
      await expect(win.getByRole('menuitem', { name: 'done', exact: true })).toBeFocused();
      await win.keyboard.press('Enter');

      await expect.poll(() => statusOf('Novel Draft'), { timeout: 10_000 }).toBe('done');
      expect(fs.readFileSync(fileOf('Novel Draft'), 'utf8')).toBe(noteText('Novel Draft', 'done'));
      await expect(inColumn('done', 'Novel Draft')).toHaveCount(1, { timeout: 10_000 });
      await expect(inColumn('done', 'Novel Draft')).toBeFocused();
      await expectAnnounced(win, 'Moved Novel Draft to done.');
    });

    await test.step('⌘Z on the board undoes the last move', async () => {
      await win.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => fs.readFileSync(fileOf('Novel Draft'), 'utf8'), { timeout: 10_000 }).toBe(noteText('Novel Draft', 'active'));
      await expect(inColumn('active', 'Novel Draft')).toHaveCount(1, { timeout: 10_000 });
      await expect(inColumn('active', 'Novel Draft')).toBeFocused();
      await expectAnnounced(win, 'Undid the move: Novel Draft back to active.');
      // The pointer move stays.
      expect(statusOf('Garden Shed')).toBe('done');
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
