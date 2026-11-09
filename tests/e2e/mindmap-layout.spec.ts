/**
 * The Mindmap layout, end to end (#2966): a Task type with a parent link
 * opens as a hierarchy; Tab makes a child note — titled in the prompt, its
 * parent set to the node; ⌘] moves a note under the one before it, one
 * field written, and ⌘Z puts it back; F2 renames the note's file.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva } from './helpers/launch';

test('a type as a mindmap: make a child, move one, undo it, rename one (#2966)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-mm-layout-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-mm-layout-project-'));
  const write = (rel: string, content: string) => { fs.mkdirSync(path.dirname(path.join(projectDir, rel)), { recursive: true }); fs.writeFileSync(path.join(projectDir, rel), content); };
  const read = (rel: string) => fs.readFileSync(path.join(projectDir, rel), 'utf-8');
  write('.minerva/types/task.md', ['---', 'label: Task', 'id: task', 'properties:', '  - name: parent', '    type: link-to-type', '    targetType: task', '    label: Parent', '---', ''].join('\n'));
  write('Launch.md', '---\ntype: task\n---\n# Launch\n');
  write('Build.md', '---\ntype: task\nparent: "[[Launch]]"\n---\n# Build\n');
  write('Market.md', '---\ntype: task\nparent: "[[Launch]]"\n---\n# Market\n');
  const market = read('Market.md');
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const map = win.getByRole('tree', { name: 'Task by Parent' });
    const node = (name: string) => map.getByRole('treeitem', { name, exact: true });

    await test.step('open the Task view as a mindmap: the view, then each note under its parent', async () => {
      await win.locator('.panel-tab[title="Objects"]').first().click();
      await win.getByRole('button', { name: 'Open Task view' }).click({ force: true });
      await win.getByRole('tab', { name: 'Mindmap' }).click();
      await expect(map.getByRole('treeitem')).toHaveCount(4, { timeout: 15_000 });
      await expect(node('Build')).toHaveAttribute('aria-level', '3');
    });

    await test.step('Tab on Build makes a child note: titled in the prompt, its parent set to Build', async () => {
      await node('Build').focus();
      await win.keyboard.press('Tab');
      const prompt = win.locator('input[aria-labelledby="prompt-dialog-title"]');
      await prompt.fill('Write code');
      await prompt.press('Enter');
      await expect.poll(() => fs.existsSync(path.join(projectDir, 'Write code.md')), { timeout: 10_000 }).toBe(true);
      expect(read('Write code.md')).toMatch(/^---\ntype: task\nparent: "\[\[Build\]\]"\n---/);
      await expect(node('Write code')).toHaveAttribute('aria-level', '4', { timeout: 10_000 });
    });

    await test.step('⌘] moves Market under Build (one field), ⌘Z puts it back', async () => {
      await node('Market').focus();
      await win.keyboard.press('Meta+]');
      await expect.poll(() => read('Market.md'), { timeout: 10_000 }).toBe(market.replace('[[Launch]]', '[[Build]]'));
      await expect(node('Market')).toHaveAttribute('aria-level', '4');
      await node('Market').focus();
      await win.keyboard.press('Meta+z');
      await expect.poll(() => read('Market.md'), { timeout: 10_000 }).toBe(market);
      await expect(node('Market')).toHaveAttribute('aria-level', '3');
    });

    await test.step('F2 renames the note\'s file', async () => {
      await node('Market').focus();
      await win.keyboard.press('F2');
      const field = win.getByRole('textbox', { name: 'Name' });
      await field.fill('Marketing');
      await field.press('Enter');
      await expect.poll(() => fs.existsSync(path.join(projectDir, 'Marketing.md')), { timeout: 10_000 }).toBe(true);
      expect(fs.existsSync(path.join(projectDir, 'Market.md'))).toBe(false);
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
