/**
 * The Graph layout (#2960), in the real app: a type with two link properties
 * opens as a graph drawn by the built-in Graph plugin in its frame. The
 * legend counts each kind of link and turns one off (the view keeps it); a
 * note outside the view (here a Project a task's parent names) is drawn and
 * can be left out; the Table lists the
 * notes with their links; and a note in the drawing takes the view's
 * selection and opens Minerva's note menu, from the keyboard — the drawing's
 * own model (arrows, Space, Shift+F10).
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva } from './helpers/launch';

test('a type view as a graph: kinds, outside notes, the table, selection and the note menu (#2960)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-graph-layout-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-graph-layout-project-'));
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(projectDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(projectDir, rel), content);
  };
  write('.minerva/types/task.md', ['---', 'label: Task', 'id: task', 'icon: ✅', 'properties:',
    '  - name: blocks', '    type: link-to-type', '    targetType: task', '    label: Blocks',
    '  - name: parent', '    type: link-to-type', '    targetType: project', '    label: Parent', '---', ''].join('\n'));
  write('.minerva/types/project.md', ['---', 'label: Project', 'id: project', 'properties: []', '---', ''].join('\n'));
  write('tasks/Alpha.md', '---\ntype: task\nblocks: "[[Bravo]]"\nparent: "[[Epic]]"\n---\n# Alpha\n');
  write('tasks/Bravo.md', '---\ntype: task\nblocks: "[[Charlie]]"\n---\n# Bravo\n');
  write('tasks/Charlie.md', '---\ntype: task\n---\n# Charlie\n');
  write('elsewhere/Epic.md', '---\ntype: project\n---\n# Epic\n'); // a Project: outside the Task view
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const graph = win.locator('[data-plugin-layout="graph"] iframe').contentFrame();

    await test.step('open the Task view, scoped to its folder, as a graph', async () => {
      await win.locator('.panel-tab[title="Objects"]').first().click();
      await win.getByRole('button', { name: 'Open Task view' }).click({ force: true });
      await win.getByRole('tab', { name: 'Graph' }).click();
      await expect(graph.locator('.gv-count')).toHaveText('3 notes + 1 outside, 3 links', { timeout: 15_000 });
    });

    await test.step('the legend counts each kind; turning one off is kept by the view', async () => {
      const legend = graph.getByRole('group', { name: 'Links drawn' });
      await expect(legend.getByRole('button')).toHaveText([/Blocks\s*2/, /Parent\s*1/]);
      await legend.getByRole('button', { name: /Parent/ }).click();
      await expect(graph.locator('.gv-count')).toHaveText('3 notes, 2 links'); // Epic went with its only link
      await expect(legend.getByRole('button', { name: /Parent/ })).toHaveAttribute('aria-pressed', 'false');
      await legend.getByRole('button', { name: /Parent/ }).click();
      await expect(graph.locator('.gv-count')).toHaveText('3 notes + 1 outside, 3 links');
    });

    await test.step('a note outside the view can be left out, and the view keeps that', async () => {
      await graph.getByRole('checkbox', { name: 'Outside notes' }).uncheck();
      await expect(graph.locator('.gv-count')).toHaveText('3 notes, 2 links');
      await graph.getByRole('checkbox', { name: 'Outside notes' }).check();
      await expect(graph.locator('.gv-count')).toHaveText('3 notes + 1 outside, 3 links');
    });

    await test.step('the table lists each note with its links, both ways', async () => {
      await graph.getByRole('button', { name: 'Table' }).click();
      const bravo = graph.getByRole('row').filter({ has: graph.getByRole('rowheader', { name: /^Bravo/ }) });
      await expect(bravo.getByRole('cell')).toHaveText(['Blocks: Charlie', 'Blocks: Alpha']);
      await graph.getByRole('button', { name: 'Table' }).click();
    });

    await test.step('a note takes the view\'s selection and opens the note menu, from the keyboard', async () => {
      const canvas = graph.getByRole('application');
      await canvas.focus();
      await canvas.press('ArrowRight'); // Alpha → Bravo, in the view's order
      await canvas.press(' ');
      await expect(win.getByRole('button', { name: 'Edit properties (1)' })).toBeVisible({ timeout: 5_000 });
      await canvas.press('Shift+F10');
      await expect(win.getByRole('menuitem', { name: /^Add Tag…/ })).toBeVisible();
      await win.keyboard.press('Escape');
      await expect(win.getByRole('menuitem', { name: /^Add Tag…/ })).toHaveCount(0);
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
