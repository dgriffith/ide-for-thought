/**
 * #2960's decision, measured: a Graph layout drawn by a core plugin gets its
 * notes the way Kanban does — the `view` event copied into the plugin frame.
 * This times that at 2,000 notes: a board (plugin frame) against a table
 * (drawn by the app), each from opening the note to its notes drawn.
 * Opt-in (MEASURE=1); not part of the suite.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva } from './helpers/launch';

test.skip(!process.env.MEASURE, 'opt-in measurement');

for (const n of [500, 2000]) test(`the view event into a plugin frame at ${n} notes (#2960)`, async () => {
  test.setTimeout(600_000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-ud-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'measure-pj-'));
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(projectDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(projectDir, rel), content);
  };
  write('.minerva/types/task.md', ['---', 'label: Task', 'id: task', 'properties:',
    '  - name: status', '    type: enum', '    options: [todo, doing, done]',
    '  - name: blocks', '    type: link-to-type', '    targetType: task', '---', ''].join('\n'));
  const statuses = ['todo', 'doing', 'done'];
  for (let i = 0; i < n; i++) write(`tasks/t${i}.md`, `---\ntype: task\nstatus: ${statuses[i % 3]}\nblocks: "[[t${(i * 7 + 1) % n}]]"\n---\n# t${i}\n`);
  write('Board.md', ['# Board', '', '```object-view', JSON.stringify({ typeId: 'task', layout: 'kanban', groupBy: 'status' }), '```', ''].join('\n'));
  write('Table.md', ['# Table', '', '```object-view', JSON.stringify({ typeId: 'task', layout: 'table' }), '```', ''].join('\n'));
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 60_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 120_000 });
    await expect(win.locator('[data-relative-path="Board.md"]').first()).toBeVisible({ timeout: 120_000 });
    await win.waitForTimeout(4000); // indexing
    await win.locator('[data-relative-path="Table.md"]').first().click();
    await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'view.togglePreview'); });
    await expect(win.locator('.preview .tv-table tbody tr')).toHaveCount(n, { timeout: 120_000 });
    await win.locator('[data-relative-path="tasks"]').first().click();
    const timings: Record<string, number[]> = { table: [], kanban: [] };
    for (let round = 0; round < 3; round++) {
      for (const which of ['table', 'kanban'] as const) {
        const t0 = Date.now();
        await win.locator(`[data-relative-path="${which === 'table' ? 'Table.md' : 'Board.md'}"]`).first().click();
        if (which === 'table') {
          await expect(win.locator('.preview .tv-table tbody tr')).toHaveCount(n, { timeout: 120_000 });
        } else {
          const board = win.locator('.preview [data-plugin-layout="kanban"] iframe').contentFrame();
          await expect(board.locator('.kb-card')).toHaveCount(n, { timeout: 120_000 });
        }
        timings[which]!.push(Date.now() - t0);
        await win.locator('[data-relative-path="tasks"]').first().click();
        await win.waitForTimeout(800);
      }
    }
    console.log(`MEASURE n=${n} table ${timings.table!.join('/')} ms, kanban ${timings.kanban!.join('/')} ms`);
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
