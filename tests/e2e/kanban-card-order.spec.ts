/**
 * Ordering cards within a Kanban column (#2922): on the stock Project board,
 * drag a card above another in its own column with the pointer — the drop
 * line marks the spot, the card lands there, and no note changes — then move
 * one with Alt+↓, with focus staying on it and the move announced. The order
 * is the view's, so every note stays byte-for-byte as it was.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { expectAnnounced, recordAnnouncements } from './helpers/announcements';
import { focusLastLayoutTab, openProjectBoard, projectNote, seedProjects } from './helpers/kanban';

test('cards are put in order within a column by pointer and by Alt+arrow, writing no note (#2922)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-kanban-order-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-kanban-order-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  const seeded: Array<[string, string]> = [['Alpha Barn', 'active'], ['Bravo Boat', 'active'], ['Charlie Cabin', 'active']];
  const fileOf = seedProjects(projectDir, seeded);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const notesUnchanged = () => {
      for (const [title, status] of seeded) expect(fs.readFileSync(fileOf(title), 'utf8')).toBe(projectNote(title, status));
    };

    const kb = await test.step('open the Project view as a board', async () => {
      const b = await openProjectBoard(win, 3);
      await recordAnnouncements(win);
      return b;
    });
    const { board, cardFor, column } = kb;
    const order = () => column('active').locator('[data-kanban-card] .kb-card-name').allTextContents();
    await expect.poll(order).toEqual(['Alpha Barn', 'Bravo Boat', 'Charlie Cabin']);

    await test.step('pointer: drag Charlie Cabin above Alpha Barn', async () => {
      const from = await cardFor('Charlie Cabin').boundingBox();
      const to = await cardFor('Alpha Barn').boundingBox();
      if (!from || !to) throw new Error('no layout for the cards');
      await win.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await win.mouse.down();
      await win.mouse.move(to.x + to.width / 2, to.y + 4, { steps: 12 });
      // The line marks the gap above Alpha Barn; its own column isn't a move target.
      await expect(cardFor('Alpha Barn')).toHaveAttribute('data-drop-before', '');
      await expect(board.locator('section.kb-column[data-drop-target]')).toHaveCount(0);
      await win.mouse.up();

      await expect.poll(order, { timeout: 10_000 }).toEqual(['Charlie Cabin', 'Alpha Barn', 'Bravo Boat']);
      await expect(board.locator('[data-drop-before], [data-drop-after], [data-dragging]')).toHaveCount(0);
      await expect(win.locator('.tab', { hasText: 'Charlie Cabin' })).toHaveCount(0); // a drop is not a click
      notesUnchanged();
    });

    await test.step('keyboard: Alt+↓ moves the focused card one place down, and focus stays with it', async () => {
      await focusLastLayoutTab(win);
      await win.keyboard.press('Tab');
      await expect(cardFor('Charlie Cabin')).toBeFocused();
      await win.keyboard.press('Alt+ArrowDown');
      await expect.poll(order, { timeout: 10_000 }).toEqual(['Alpha Barn', 'Charlie Cabin', 'Bravo Boat']);
      await expect(cardFor('Charlie Cabin')).toBeFocused();
      await expectAnnounced(win, 'Charlie Cabin moved below Alpha Barn');
      notesUnchanged();
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
