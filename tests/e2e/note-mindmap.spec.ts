/**
 * A note as a mindmap, end to end (#2965): from an empty note, a three-level
 * outline built entirely by the map's keys — Tab for a child, Enter for a
 * sibling, each named in place — then saved, and the file read back; ⌘Z in
 * the map undoes; Side by side shows the editor beside the map. And the
 * in-app draw of a 1,000-item note, measured (#2964 left that to the first
 * story that puts a map on screen).
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva } from './helpers/launch';

test('build an outline in a note\'s mindmap by keys, and find it in the file (#2965)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-mindmap-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-mindmap-project-'));
  fs.writeFileSync(path.join(projectDir, 'Plan.md'), '');
  fs.writeFileSync(path.join(projectDir, 'Big.md'), `# Big\n\n${Array.from({ length: 100 }, (_, i) => `## Section ${i}\n\n${Array.from({ length: 9 }, (_, j) => `- point ${i}.${j}`).join('\n')}\n`).join('\n')}`);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const command = (id: string) => app.evaluate(({ BrowserWindow }, c) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', c); }, id);
    const map = win.getByRole('tree', { name: /^Outline of Plan/ });
    const node = (name: string) => map.getByRole('treeitem', { name, exact: true });
    const nameIt = async (name: string) => {
      const input = win.getByRole('textbox', { name: 'Name' });
      await expect(input).toBeFocused();
      await input.fill(name);
      await input.press('Enter');
      await expect(input).toHaveCount(0);
      await expect(node(name)).toBeFocused(); // back on the node just named, for the next key
    };

    await test.step('open the empty note as a mindmap: just its title', async () => {
      await win.locator('[data-relative-path="Plan.md"]').first().click();
      await command('view.toggleMindmap');
      await expect(map.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });
      await expect(node('Plan')).toHaveAttribute('aria-level', '1');
    });

    await test.step('three levels, by keys alone', async () => {
      await node('Plan').focus();
      await win.keyboard.press('Tab');
      await nameIt('Trip');
      await win.keyboard.press('Tab');
      await nameIt('Pack');
      await win.keyboard.press('Enter');
      await nameIt('Book');
      await win.keyboard.press('Tab');
      await nameIt('Hotel');
      await win.keyboard.press('Enter');
      await nameIt('Train');
      await expect(node('Hotel')).toHaveAttribute('aria-level', '4');
      await expect(map.getByRole('treeitem')).toHaveCount(6);
    });

    await test.step('⌘Z in the map undoes the last edit; ⇧⌘Z redoes it', async () => {
      await node('Train').focus();
      await win.keyboard.press('Meta+z');
      await expect(node('Train')).toHaveCount(0);
      await node('Hotel').focus();
      await win.keyboard.press('Meta+Shift+z');
      await expect(node('Train')).toHaveCount(1);
    });

    await test.step('saved, the file holds exactly that outline', async () => {
      await win.keyboard.press('Meta+s');
      await expect.poll(() => fs.readFileSync(path.join(projectDir, 'Plan.md'), 'utf-8'), { timeout: 10_000 })
        .toBe('# Trip\n## Pack\n## Book\n### Hotel\n### Train\n');
    });

    await test.step('Side by side: the editor beside the map, the cursor following the selection', async () => {
      await win.getByRole('button', { name: 'Side by side' }).click();
      await expect(win.locator('.editor-panel .cm-content')).toBeVisible();
      await node('Hotel').click();
      await expect(win.locator('.cm-activeLine')).toHaveText('### Hotel');
    });

    await test.step('a 1,000-item note opens as a map: every node drawn, timed', async () => {
      await win.locator('[data-relative-path="Big.md"]').first().click();
      await expect(win.locator('.editor-panel .cm-content')).toContainText('point 0.0'); // the note is open (its top: the editor draws only what's in view)
      const started = Date.now(); // from the click: switching modes, parsing, laying out and drawing
      await win.getByRole('button', { name: 'Mindmap', exact: true }).click();
      const big = win.getByRole('tree', { name: /^Outline of Big/ });
      await expect(big.getByRole('treeitem')).toHaveCount(1 + 1 + 100 + 900, { timeout: 20_000 });
      const ms = Date.now() - started;
      console.log(`[mindmap] 1,002 nodes drawn in ${ms} ms`);
      test.info().annotations.push({ type: 'mindmap-1000-draw-ms', description: String(ms) });
      expect(ms).toBeLessThan(10_000); // a hang, not a budget: the number is the record
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
