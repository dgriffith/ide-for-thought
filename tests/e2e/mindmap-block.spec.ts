/**
 * A `:::mindmap` block, end to end (#2966): a parent-linked hierarchy of
 * tasks drawn in the note's preview from main's walk, a node opening its
 * note, and the note exported to HTML with the hierarchy as a still picture.
 */
import { test, expect, type Page } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva } from './helpers/launch';

async function runExport(win: Page, args: Record<string, unknown>): Promise<string[]> {
  const res = await win.evaluate(async (a) => (window as unknown as {
    api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
  }).api.publish.runExport(a), args);
  expect(res).not.toBeNull();
  return res!.writtenPaths;
}

test('a :::mindmap block draws a hierarchy of notes, opens them, and exports (#2966)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-mm-block-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-mm-block-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-mm-block-out-'));
  const write = (rel: string, content: string) => { fs.mkdirSync(path.dirname(path.join(projectDir, rel)), { recursive: true }); fs.writeFileSync(path.join(projectDir, rel), content); };
  write('.minerva/types/task.md', ['---', 'label: Task', 'id: task', 'properties:', '  - name: parent', '    type: link-to-type', '    targetType: task', '---', ''].join('\n'));
  write('tasks/Launch.md', '---\ntype: task\n---\n# Launch\n');
  write('tasks/Build.md', '---\ntype: task\nparent: "[[Launch]]"\n---\n# Build\n');
  write('tasks/Market.md', '---\ntype: task\nparent: "[[Launch]]"\n---\n# Market\n');
  write('tasks/Code.md', '---\ntype: task\nparent: "[[Build]]"\n---\n# Code\n');
  write('Plan.md', '# Plan\n\n:::mindmap\n[[Launch]]\nrelation: parent\n:::\n');
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const map = win.locator('.preview').getByRole('tree', { name: 'Mindmap of Launch' });

    await test.step('the preview draws the hierarchy main walked', async () => {
      await win.locator('[data-relative-path="Plan.md"]').first().click();
      await win.getByRole('button', { name: 'Preview', exact: true }).click();
      await expect(map.getByRole('treeitem')).toHaveCount(4, { timeout: 15_000 });
      await expect(map.getByRole('treeitem', { name: 'Code' })).toHaveAttribute('aria-level', '3');
    });

    await test.step('exported to HTML, a still picture of every node', async () => {
      const written = await runExport(win, { exporterId: 'note-html', input: { kind: 'single-note', relativePath: 'Plan.md' }, outputDir: outDir, linkPolicy: 'inline-title' });
      const html = fs.readFileSync(written.find((p) => p.endsWith('.html'))!, 'utf-8');
      expect(html).toMatch(/<svg[^>]*aria-label="Mindmap of Launch"/);
      for (const name of ['Launch', 'Build', 'Market', 'Code']) expect(html).toContain(`>${name}</tspan>`);
      expect(html, 'no raw directive').not.toContain(':::mindmap');
    });

    await test.step('a node opens its note', async () => {
      await map.getByRole('treeitem', { name: 'Market' }).dblclick();
      await expect(win.locator('.tab.active')).toContainText('Market', { timeout: 10_000 });
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
