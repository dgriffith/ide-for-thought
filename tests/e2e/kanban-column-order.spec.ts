/**
 * Reordering a board's columns (#2614): drag a column header with the
 * pointer (pointer events, not HTML5 drag-and-drop), check the order is the
 * view's — it survives switching to another layout and back — then move a
 * column with the keyboard alone through the header's menu, and hear it in
 * the live region.
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
  ['Tax Return', 'done'],
  ['Pottery Class', 'paused'],
  ['Someday Boat', null],
];

test('Kanban columns: drag a header to reorder, the order stays with the view, and Move column by keyboard (#2614)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-kanban-cols-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-kanban-cols-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seedProjects(projectDir, PROJECTS);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const { board, column } = await test.step('open the Project view as a board', async () => {
      const b = await openProjectBoard(win, PROJECTS.length);
      await expect(b.board.locator('.kb-col-label')).toHaveText(['active', 'paused', 'done', 'abandoned', 'No value']);
      return b;
    });
    const labels = board.locator('.kb-col-label');

    await test.step('drag the done header in front of active', async () => {
      const from = await column('done').locator('.kb-col-label').boundingBox();
      const to = await column('active').boundingBox();
      if (!from || !to) throw new Error('board not laid out');
      await win.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await win.mouse.down();
      await win.mouse.move(to.x + 20, from.y + from.height / 2, { steps: 12 });
      // Feedback while dragging: the column dims, and a marker shows where it lands.
      await expect(column('done')).toHaveAttribute('data-dragging', '');
      await expect(column('active')).toHaveAttribute('data-drop-side', 'before');
      await win.mouse.up();
      await expect(labels).toHaveText(['done', 'active', 'paused', 'abandoned', 'No value']);
      await expect(board.locator('[data-drop-side], [data-dragging]')).toHaveCount(0);
    });

    await test.step('the order is the view\'s: it survives another layout and back', async () => {
      await win.getByRole('tab', { name: 'Table' }).click();
      await expect(board).toHaveCount(0);
      await win.getByRole('tab', { name: 'Kanban' }).click();
      await expect(labels).toHaveText(['done', 'active', 'paused', 'abandoned', 'No value']);
    });

    await test.step('keyboard: ↑ to the header, its menu, Move column right, announced', async () => {
      await recordAnnouncements(win);
      await board.locator('[data-kanban-card]', { hasText: 'Tax Return' }).focus();
      await win.keyboard.press('ArrowUp');
      const menuButton = column('done').getByRole('button', { name: 'done column actions' });
      await expect(menuButton).toBeFocused();
      await win.keyboard.press('Enter');
      const menu = win.getByRole('menu', { name: 'done column' });
      await expect(menu).toBeVisible();
      // done is first: Move column left is offered but disabled, so focus starts on right.
      await expect(menu.getByRole('menuitem', { name: 'Move column left' })).toHaveAttribute('aria-disabled', 'true');
      await expect(menu.getByRole('menuitem', { name: 'Move column right' })).toBeFocused();
      await win.keyboard.press('Enter');
      await expect(menu).toHaveCount(0);
      await expect(labels).toHaveText(['active', 'done', 'paused', 'abandoned', 'No value']);
      await expect(menuButton).toBeFocused();
      await expectAnnounced(win, 'Moved done column to position 2 of 5');

      // Escape closes the menu and puts focus back on the header.
      await win.keyboard.press('Enter');
      await expect(menu).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(menu).toHaveCount(0);
      await expect(menuButton).toBeFocused();
    });

    await test.step('Show empty columns off hides the empty abandoned column', async () => {
      await win.getByRole('checkbox', { name: 'Show empty columns' }).uncheck();
      await expect(labels).toHaveText(['active', 'done', 'paused', 'No value']);
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
