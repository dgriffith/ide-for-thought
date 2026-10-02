/**
 * Query blocks export the way the preview shows them (#2512, epic #2508).
 *
 * A note holding a SPARQL list, a SPARQL table, a backlinks block and a SQL
 * timeseries chart: opened in the real preview, exported through the real
 * `publish.runExport`, and compared — the same result rows in the same order,
 * the chart kept as an image of what it drew, and no raw directive text.
 */
import { test, expect, type Page } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const TAGGED = ['Kampa Museum', 'Mucha Museum', 'National Gallery'];
const BY_TAG = (tag: string) =>
  `SELECT ?title ?path WHERE { ?note minerva:hasTag ?t . ?t minerva:tagName "${tag}" . ?note dc:title ?title . ?note minerva:relativePath ?path . } ORDER BY ?title`;

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  for (const title of TAGGED) write(`trip/places/${title}.md`, `# ${title}\n\n#museum\n\nPart of [[plan]].\n`);
  write('trip/visits.csv', 'month,visits\n2026-05,3\n2026-06,5\n2026-07,2\n');
  write('trip/plan.md', [
    '# Plan', '',
    ':::query-list', 'title: Museums', '---', BY_TAG('museum'), ':::', '',
    ':::query-table', BY_TAG('museum'), ':::', '',
    ':::query-backlinks', ':::', '',
    ':::query-timeseries', 'language: sql', 'title: Visits', 'x: month', 'y: visits', '---', 'SELECT month, visits FROM trip_visits ORDER BY month', ':::', '',
  ].join('\n'));
}

/** Result link texts per query block, in order, from a container. */
async function blockLinks(win: Page, rootSelector: string): Promise<string[][]> {
  return win.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const scope = (root as HTMLElement).shadowRoot ?? root;
    const blocks = Array.from(scope.querySelectorAll('.query-block')).filter((b) => b.querySelector('a, canvas, img, table'));
    return blocks.map((b) => Array.from(b.querySelectorAll('a')).map((a) => a.textContent.trim()));
  }, rootSelector);
}

test('query blocks export with the rows the preview shows, and charts as images (#2512)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-query-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-query-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-query-out-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 1000, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path="trip"]').first()).toBeVisible({ timeout: 10_000 });

    const preview = await test.step('open the note in the preview', async () => {
      await win.locator('[data-relative-path="trip"]').first().click();
      await win.locator('[data-relative-path="trip/plan.md"]').first().click();
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:togglePreview'); });
      await expect(win.locator('.preview .query-result-list a').first()).toBeVisible({ timeout: 15_000 });
      await expect(win.locator('.preview .query-block canvas')).toHaveCount(1, { timeout: 15_000 });
      await expect.poll(async () => (await blockLinks(win, '.preview')).length, { timeout: 15_000 }).toBe(4);
      return blockLinks(win, '.preview');
    });
    // The list links titles; the table links its `path` column (the preview
    // shows the path itself); backlinks name the three notes; the chart has none.
    expect(preview).toEqual([TAGGED, TAGGED.map((t) => `trip/places/${t}.md`), TAGGED, []]);
    await win.locator('.preview').screenshot({ path: 'test-results/export-query-preview.png' });

    const html = await test.step('export through the real pipeline', async () => {
      const res = await win.evaluate(async (dir) => (window as unknown as {
        api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
      }).api.publish.runExport({
        exporterId: 'note-html', input: { kind: 'single-note', relativePath: 'trip/plan.md' }, outputDir: dir, linkPolicy: 'inline-title',
      }), outDir);
      const file = res!.writtenPaths.find((p) => p.endsWith('.html'))!;
      return fs.readFileSync(path.isAbsolute(file) ? file : path.join(outDir, file), 'utf-8');
    });
    expect(html, 'no raw directive in the export').not.toContain(':::query');
    expect(html).not.toContain('Loading...');
    expect(html).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]{1000,}"[^>]*alt="Chart"/);

    const exported = await test.step('compare against the preview', async () => {
      await win.evaluate((doc) => {
        const host = document.createElement('div');
        host.id = 'export-under-test';
        host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;overflow:auto;padding:24px;';
        const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(doc)![1]!;
        const styles = Array.from(doc.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)).map((m) => m[0]).join('');
        host.attachShadow({ mode: 'open' }).innerHTML = styles + body;
        document.body.appendChild(host);
      }, html);
      return blockLinks(win, '#export-under-test');
    });
    expect(exported).toEqual(preview);
    await win.locator('#export-under-test').screenshot({ path: 'test-results/export-query-export.png' });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
