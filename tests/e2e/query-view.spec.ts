/**
 * A view from a query, in a note (#2945, epic #2936): an `object-view` whose
 * notes come from a SPARQL query, in the real app — main runs the query
 * (`queryViews:rows`, read-only), the preview draws the rows as a table, a
 * malformed query says why in place, a note written afterwards appears (the
 * graph-changed refresh), and the export draws the same rows, linked.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const QUERY = 'SELECT ?note ?due WHERE { ?note minerva:meta-due ?due }';

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('tasks/Mow.md', '---\ndue: 2026-11-01\n---\n# Mow the lawn\n');
  write('tasks/Paint.md', '---\ndue: 2026-10-07\n---\n# Paint the shed\n');
  write('plan.md', [
    '# Plan', '',
    '```object-view', JSON.stringify({ query: QUERY, layout: 'table', sortColumn: 'due', sortDir: 'asc' }), '```', '',
    '```object-view', JSON.stringify({ query: 'SELECT WHERE {', layout: 'table' }), '```', '',
  ].join('\n'));
}

/** The table's row titles under the preview. */
async function rows(win: import('./helpers/test').Page): Promise<string[]> {
  return win.evaluate(() => Array.from(document.querySelectorAll('.preview .tv-table tbody tr td:first-child .tv-cell-title-inner > span:last-child')).map((e) => e.textContent.trim()));
}

test('a SPARQL query view in a note: its rows, an inline error, a refresh, and the export (#2945)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-query-view-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-query-view-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-query-view-out-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

    await test.step('the preview runs the query and draws its notes, sorted by the due column', async () => {
      await win.locator('[data-relative-path="plan.md"]').first().click();
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'view.togglePreview'); });
      await expect(win.locator('.preview .tv-table tbody tr')).toHaveCount(2, { timeout: 20_000 });
      expect(await rows(win)).toEqual(['Paint the shed', 'Mow the lawn']);
    });

    await test.step('the malformed query says why, in place', async () => {
      await expect(win.locator('.preview [role="alert"]').filter({ hasText: "The query couldn't run" })).toHaveCount(1, { timeout: 15_000 });
    });

    await test.step('a note written afterwards appears: the view runs again on the graph change', async () => {
      fs.writeFileSync(path.join(projectDir, 'tasks', 'Rake.md'), '---\ndue: 2026-10-20\n---\n# Rake the leaves\n');
      await expect.poll(() => rows(win), { timeout: 20_000 }).toEqual(['Paint the shed', 'Rake the leaves', 'Mow the lawn']);
    });

    await test.step('the export draws the same rows, each linked to its note', async () => {
      const res = await win.evaluate(async (dir) => (window as unknown as {
        api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
      }).api.publish.runExport({
        exporterId: 'note-html', input: { kind: 'single-note', relativePath: 'plan.md' }, outputDir: dir, linkPolicy: 'inline-title',
      }), outDir);
      const file = res!.writtenPaths.find((p) => p.endsWith('.html'))!;
      const html = fs.readFileSync(path.isAbsolute(file) ? file : path.join(outDir, file), 'utf-8');
      for (const title of ['Paint the shed', 'Rake the leaves', 'Mow the lawn']) expect(html, `${title} is exported`).toContain(title);
      expect(html, 'the failing query says so in the export too').toContain("The query couldn't run");
      expect(html, 'no raw spec in the export').not.toContain('&quot;query&quot;');
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
