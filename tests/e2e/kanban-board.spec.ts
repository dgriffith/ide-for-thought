/**
 * The Kanban board (#2602): open the stock Project type as a board, read its
 * columns (Project's `status` options, in declared order, with counts — and
 * No value, because one project leaves `status` empty) and cards, then walk
 * the board by keyboard alone and open a card with Enter.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const PROJECTS: [string, string | null][] = [
  ['Garden Shed', 'active'],
  ['Novel Draft', 'active'],
  ['Tax Return', 'done'],
  ['Pottery Class', 'paused'],
  ['Someday Boat', null],
];

function seed(dir: string): void {
  for (const [title, status] of PROJECTS) {
    const rel = path.join(dir, 'projects', `${title}.md`);
    fs.mkdirSync(path.dirname(rel), { recursive: true });
    fs.writeFileSync(rel, `---\ntype: project\n${status ? `status: ${status}\n` : ''}---\n# ${title}\n`);
  }
}

test('a Project board: columns by status, cards, and keyboard navigation to open a card (#2602)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-kanban-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-kanban-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const board = win.locator('.kb-board');
    const cardFor = (title: string) => board.locator('[data-kanban-card]', { hasText: title });

    await test.step('open the Project view as a board', async () => {
      await win.locator('.panel-tab[title="Objects"]').first().click();
      await win.getByRole('button', { name: 'Open Project view' }).click({ force: true });
      await win.getByRole('tab', { name: 'Kanban' }).click();
      await expect(win.getByRole('tab', { name: 'Kanban' })).toHaveAttribute('aria-selected', 'true');
      await expect(board.locator('[data-kanban-card]')).toHaveCount(5, { timeout: 15_000 });
    });

    await test.step('columns: the status options in order, with counts, then No value', async () => {
      await expect(board.locator('.kb-col-label')).toHaveText(['active', 'paused', 'done', 'abandoned', 'No value']);
      await expect(board.locator('.kb-col-count')).toHaveText(['2', '1', '1', '0', '1']);
      await expect(win.getByRole('list', { name: 'active, 2 cards' }).getByRole('listitem')).toHaveCount(2);
      await expect(win.getByRole('list', { name: 'No value, 1 card' })).toContainText('Someday Boat');
      // Project has one enum property, so there's nothing to pick.
      await expect(win.getByRole('combobox', { name: 'Group by' })).toHaveCount(0);
    });

    await test.step('keyboard: Tab onto the board, arrows across it, Enter opens the card', async () => {
      // The board is one tab stop, right after the layout switcher.
      await win.getByRole('tab', { name: 'Kanban' }).focus();
      await win.keyboard.press('Tab');
      await expect(cardFor('Garden Shed')).toBeFocused();
      await win.keyboard.press('ArrowDown');
      await expect(cardFor('Novel Draft')).toBeFocused();
      await win.keyboard.press('ArrowRight'); // paused has one card: its last
      await expect(cardFor('Pottery Class')).toBeFocused();
      await win.keyboard.press('ArrowRight');
      await expect(cardFor('Tax Return')).toBeFocused();
      await win.keyboard.press('ArrowRight'); // abandoned is empty: skipped
      await expect(cardFor('Someday Boat')).toBeFocused();
      await win.keyboard.press('ArrowLeft');
      await expect(cardFor('Tax Return')).toBeFocused();
      // Only the focused card is in the tab order.
      await expect(board.locator('[data-kanban-card][tabindex="0"]')).toHaveCount(1);
      await win.keyboard.press('Enter');
      await expect(win.locator('.tab.active')).toContainText('Tax Return', { timeout: 10_000 });
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
