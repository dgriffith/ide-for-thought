/**
 * The graph, end to end (#2961): open the thoughtbase graph from a note, narrow
 * it by type, find a note, trace how two are connected, and export what's
 * drawn as a PNG and an SVG (the save dialog answered by the spec); and a
 * Graph-layout view embedded in a note exported to HTML as a still picture
 * of the graph, with a key of its kinds of link.
 */
import { test, expect, type Page } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva } from './helpers/launch';

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('.minerva/types/task.md', ['---', 'label: Task', 'id: task', 'icon: ✅', 'properties:',
    '  - name: blocks', '    type: link-to-type', '    targetType: task', '    label: Blocks', '---', ''].join('\n'));
  write('tasks/Survey.md', '---\ntype: task\nblocks: "[[Design]]"\n---\n# Survey\n');
  write('tasks/Design.md', '---\ntype: task\nblocks: "[[Build]]"\n---\n# Design\n');
  write('tasks/Build.md', '---\ntype: task\n---\n# Build\n\nSee [[Notes on building]].\n');
  write('Notes on building.md', '# Notes on building\n');
  write('Unrelated.md', '# Unrelated\n');
  write('Plan.md', ['# Plan', '', '```object-view', JSON.stringify({ typeId: 'task', layout: 'graph' }), '```', ''].join('\n'));
}

async function runExport(win: Page, args: Record<string, unknown>): Promise<string[]> {
  const res = await win.evaluate(async (a) => (window as unknown as {
    api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
  }).api.publish.runExport(a), args);
  expect(res).not.toBeNull();
  return res!.writtenPaths;
}

test('the graph: from a note, by type, find, trace, export a PNG and an SVG; a graph view exported to HTML (#2961)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-graph-export-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-graph-export-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-graph-export-out-'));
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path="tasks"]').first()).toBeVisible({ timeout: 10_000 });
    const graph = win.locator('.tb-graph');
    const canvas = graph.locator('.canvas');
    const count = graph.locator('.count');
    // Once the canvas has stopped moving: Find and a selection add to the toolbar, which can wrap (#3066).
    const centre = async () => {
      let last = '';
      for (let i = 0; i < 20; i++) {
        const b = (await canvas.boundingBox())!;
        if (JSON.stringify(b) === last) return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
        last = JSON.stringify(b);
        await win.waitForTimeout(100);
      }
      const b = (await canvas.boundingBox())!;
      return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
    };
    const find = async (q: string) => {
      await expect(canvas).toHaveAttribute('data-settled', '', { timeout: 15_000 });
      await graph.getByRole('searchbox', { name: 'Find a note' }).fill(q);
      return centre();
    };

    await test.step('open it from a note: centred on that note, one step out', async () => {
      await win.locator('[data-relative-path="tasks"]').first().click(); // open the folder
      await win.locator('[data-relative-path="tasks/Design.md"]').first().click({ button: 'right' });
      await win.getByRole('button', { name: 'Show in Graph' }).click();
      await expect(graph.locator('.focus')).toContainText('Around Design', { timeout: 15_000 });
      await expect(count).toHaveText(/^3 of 6 nodes/);
      await graph.getByRole('button', { name: 'Whole graph' }).click();
      await expect(count).toHaveText(/^6 of 6 nodes/, { timeout: 10_000 });
    });

    await test.step('narrow it to the tasks', async () => {
      await graph.getByLabel('Type').selectOption('task');
      await expect(count).toHaveText(/^3 of 6 nodes, 2 connections/);
    });

    await test.step('find Survey and trace it to Build: two steps of Blocks', async () => {
      const s = await find('Survey');
      await expect(graph.locator('.found')).toHaveText('1 of 1');
      await win.mouse.click(s.x, s.y);
      await graph.getByRole('button', { name: 'Trace from “Survey”' }).click();
      const b = await find('Build');
      await win.mouse.click(b.x, b.y);
      await expect(graph.locator('.path-steps')).toContainText('Survey');
      await expect(graph.locator('.path-steps')).toContainText('Blocks');
      await expect(graph.locator('.path-steps')).toContainText('2 steps');
    });

    const saveAs = async (file: string) => app.evaluate(({ dialog }, p) => {
      (dialog as unknown as { showSaveDialog: () => Promise<unknown> }).showSaveDialog = async () => ({ canceled: false, filePath: p });
    }, file);

    await test.step('export the whole graph as a PNG: a real image, of a sensible size', async () => {
      const png = path.join(outDir, 'graph.png');
      await saveAs(png);
      await graph.getByRole('button', { name: 'Export' }).click();
      await graph.getByRole('menuitem', { name: 'PNG of the whole graph…' }).click();
      await expect.poll(() => fs.existsSync(png), { timeout: 10_000 }).toBe(true);
      const bytes = fs.readFileSync(png);
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      expect(width).toBeGreaterThan(200);
      expect(height).toBeGreaterThan(100);
      fs.copyFileSync(png, 'test-results/graph-export.png');
    });

    await test.step('export this view as an SVG: the tasks, the trace marked, a key of the kinds', async () => {
      const svgFile = path.join(outDir, 'graph.svg');
      await saveAs(svgFile);
      await graph.getByRole('button', { name: 'Export' }).click();
      await graph.getByRole('menuitem', { name: 'SVG of this view…' }).click();
      await expect.poll(() => fs.existsSync(svgFile), { timeout: 10_000 }).toBe(true);
      const svg = fs.readFileSync(svgFile, 'utf-8');
      for (const name of ['Survey', 'Design', 'Build']) expect(svg).toContain(`>${name}</text>`);
      expect(svg).not.toContain('>Unrelated</text>'); // filtered out by type
      expect(svg).toMatch(/stroke-width="3"\/><text [^>]*>Blocks<\/text>/);
      expect(svg).not.toMatch(/<style|url\(/);
    });

    await test.step('a Graph-layout view in a note exports to HTML as a still picture of the graph', async () => {
      const written = await runExport(win, { exporterId: 'note-html', input: { kind: 'single-note', relativePath: 'Plan.md' }, outputDir: outDir, linkPolicy: 'inline-title' });
      const file = written.find((p) => p.endsWith('.html'))!;
      fs.copyFileSync(file, 'test-results/graph-export-note.html');
      const html = fs.readFileSync(file, 'utf-8');
      expect(html).toMatch(/<svg[^>]*aria-label="Graph of Task: 3 notes, 2 links"/);
      for (const name of ['Survey', 'Design', 'Build']) expect(html).toContain(`>${name}</text>`);
      expect(html).toMatch(/>Blocks<\/text>/);
      expect(html, 'no raw spec').not.toContain('&quot;typeId&quot;');
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
