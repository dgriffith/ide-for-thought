/**
 * A plugin-drawn embed survives editing its note (#2828 follow-up). The
 * preview swaps its HTML on every render tick, and the embed's wrapper is
 * re-adopted from the block cache. An iframe that leaves the document
 * unloads, so the Kanban board inside an ```object-view``` used to reload on
 * every keystroke, and its host, still holding the old session, never
 * connected the new page: the embed went blank after the first edit.
 * Now the wrapper is parked and moved with `moveBefore`, so the frame's page
 * is the same one, still drawn, after typing.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

test("a Kanban embed's frame lives through edits to its note, still drawn", async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-embed-edits-userdata-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-embed-edits-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), dir, { recursive: true });
  const write = (rel: string, c: string) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), c); };
  write('.minerva/types/task.md', ['---', 'label: Task', 'id: task', 'properties:', '  - name: status', '    type: enum', '    options: [todo, done]', '---', ''].join('\n'));
  write('tasks/Water the plants.md', '---\ntype: task\nstatus: todo\n---\n# Water the plants\n');
  write('Board.md', ['# Board', '', '```object-view', JSON.stringify({ typeId: 'task', layout: 'kanban' }), '```', '', 'Below the board.', ''].join('\n'));
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 1000, rootPath: dir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const board = win.locator('.preview .object-view-block [data-plugin-layout="kanban"] iframe').contentFrame();

    await test.step('the note, editor and preview side by side, the board drawn', async () => {
      await win.locator('[data-relative-path="Board.md"]').first().click();
      // Cycle the view mode until both the editor and the preview are showing.
      await expect.poll(async () => {
        if (await win.locator('.cm-content').isVisible() && await win.locator('.preview .object-view-block').count() > 0) return true;
        await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'view.togglePreview'); });
        return false;
      }, { timeout: 10_000, intervals: [500] }).toBe(true);
      await expect(board.locator('.kb-card')).toHaveCount(1, { timeout: 15_000 });
    });

    await test.step('typing re-renders the preview; the board is the same page, still drawn', async () => {
      // A mark on the frame's own window: a reload would lose it.
      await board.locator('body').evaluate(() => { (window as unknown as { __mark?: number }).__mark = 42; });
      await win.locator('.cm-content').click();
      await win.keyboard.press('ControlOrMeta+End');
      for (const ch of ' more') {
        await win.keyboard.type(ch);
        await win.waitForTimeout(250); // past the preview's 120ms render debounce, each time
      }
      await expect(win.locator('.preview')).toContainText('Below the board. more');
      await expect(board.locator('.kb-card')).toHaveCount(1);
      expect(await board.locator('body').evaluate(() => (window as unknown as { __mark?: number }).__mark ?? null)).toBe(42);
    });
  } finally {
    await closeMinerva(app);
  }
});
