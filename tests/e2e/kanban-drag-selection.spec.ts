/**
 * Dragging a selection on a board (#2941): ⌘-click two cards, drag one of
 * them onto *done*, and both notes say `status: done` — the ghost counted
 * them on the way — then one ⌘Z on the board puts both back.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { dragCardToColumn, openProjectBoard, seedProjects } from './helpers/kanban';

test('dragging a selected card moves the whole selection, with one undo (#2941)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-kanban-drag-sel-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-kanban-drag-sel-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  const fileOf = seedProjects(projectDir, [['Garden Shed', 'active'], ['Novel Draft', 'paused'], ['Tax Return', 'done'], ['Boat Repair', 'active']]);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const statusOf = (title: string) => /^status: (.*)$/m.exec(fs.readFileSync(fileOf(title), 'utf8'))?.[1];
    const kb = await openProjectBoard(win, 4);

    await test.step('⌘-click Garden Shed (active) and Novel Draft (paused)', async () => {
      await kb.cardFor('Garden Shed').click({ modifiers: ['ControlOrMeta'] });
      await kb.cardFor('Novel Draft').click({ modifiers: ['ControlOrMeta'] });
      await expect(kb.cardFor('Novel Draft')).toHaveAttribute('aria-pressed', 'true');
      await expect(kb.cardFor('Garden Shed')).toHaveAttribute('aria-pressed', 'true');
    });

    await test.step('drag Garden Shed onto done: the ghost counts 2, and both notes move', async () => {
      await dragCardToColumn(win, kb, 'Garden Shed', 'done', async () => {
        await expect(kb.frame.locator('[data-kanban-ghost-count]')).toHaveText('2');
      });
      await expect.poll(() => statusOf('Garden Shed'), { timeout: 10_000 }).toBe('done');
      await expect.poll(() => statusOf('Novel Draft'), { timeout: 10_000 }).toBe('done');
      expect(statusOf('Boat Repair')).toBe('active'); // not selected, not moved
      await expect(kb.inColumn('done', 'Novel Draft')).toHaveCount(1, { timeout: 10_000 });
    });

    await test.step('one ⌘Z on the board puts both back', async () => {
      await kb.cardFor('Garden Shed').focus();
      await win.keyboard.press('ControlOrMeta+z');
      await expect.poll(() => statusOf('Garden Shed'), { timeout: 10_000 }).toBe('active');
      await expect.poll(() => statusOf('Novel Draft'), { timeout: 10_000 }).toBe('paused');
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
