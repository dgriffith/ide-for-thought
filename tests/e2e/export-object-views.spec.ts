/**
 * Object views export the way the preview shows them (#2510, epic #2508).
 *
 * The unit tests prove the plumbing; only the real app proves the result
 * matches what the user saw. This seeds typed notes and a note embedding a
 * list and a table view, opens it in the preview, exports it through the
 * real `publish.runExport` (the window renders the views with the preview's
 * own component), and compares — same rows, same order, same columns — then
 * screenshots both for review.
 */
import { test, expect, type Page } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const PLACES: Array<[string, string, string]> = [
  ['Kampa Museum', 'Prague', 'museum'],
  ['Széchenyi Baths', 'Budapest', 'baths'],
  ['Petřín Tower', 'Prague', 'viewpoint'],
];

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('.minerva/types/place.md', [
    '---', 'label: Place', 'id: place', 'icon: 📍', 'properties:',
    '  - name: city', '    type: text', '    label: City',
    '  - name: kind', '    type: text', '    label: Kind', '---', '',
  ].join('\n'));
  for (const [title, city, kind] of PLACES) {
    write(`trip/places/${title}.md`, `---\ntype: place\ncity: ${city}\nkind: ${kind}\n---\n# ${title}\n`);
  }
  write('trip/plan.md', [
    '# Plan', '',
    '```object-view', '{"typeId":"place","layout":"list"}', '```', '',
    '```object-view', '{"typeId":"place","layout":"table","sortColumn":"__title","sortDir":"desc","columns":["city"]}', '```', '',
  ].join('\n'));
}

/** Row titles per rendered view, in order, from a container. */
async function rowTitles(scope: Page, rootSelector: string): Promise<string[][]> {
  return scope.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const shadow = (root as HTMLElement).shadowRoot ?? root;
    return Array.from(shadow.querySelectorAll('.tv-list, .tv-table')).map((view) =>
      view.classList.contains('tv-list')
        ? Array.from(view.querySelectorAll('.tv-list-title')).map((e) => e.textContent.trim())
        : Array.from(view.querySelectorAll('tbody tr td:first-child .tv-cell-title-inner > span:last-child')).map((e) => e.textContent.trim()));
  }, rootSelector);
}

test('object views export with the rows, order and columns the preview shows (#2510)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-views-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-views-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-views-out-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path="trip"]').first()).toBeVisible({ timeout: 10_000 });

    const preview = await test.step('open the note in the preview', async () => {
      await win.locator('[data-relative-path="trip"]').first().click();
      await win.locator('[data-relative-path="trip/plan.md"]').first().click();
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:togglePreview'); });
      await expect(win.locator('.preview .tv-list-title').first()).toBeVisible({ timeout: 15_000 });
      await expect(win.locator('.preview .tv-table tbody tr')).toHaveCount(PLACES.length, { timeout: 15_000 });
      return rowTitles(win, '.preview');
    });
    expect(preview).toHaveLength(2);
    expect([...preview[0]!].sort()).toEqual(PLACES.map(([t]) => t).sort()); // list: every place
    expect(preview[1]).toEqual(['Széchenyi Baths', 'Petřín Tower', 'Kampa Museum']); // table: title, descending
    await win.locator('.preview').screenshot({ path: 'test-results/export-views-preview.png' });

    const html = await test.step('export through the real pipeline', async () => {
      const res = await win.evaluate(async (dir) => (window as unknown as {
        api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
      }).api.publish.runExport({
        exporterId: 'note-html', input: { kind: 'single-note', relativePath: 'trip/plan.md' }, outputDir: dir, linkPolicy: 'inline-title',
      }), outDir);
      expect(res).not.toBeNull();
      const file = res!.writtenPaths.find((p) => p.endsWith('.html'))!;
      return fs.readFileSync(path.isAbsolute(file) ? file : path.join(outDir, file), 'utf-8');
    });

    expect(html, 'no raw spec in the export').not.toContain('&quot;typeId&quot;');
    expect(html).toContain('class="minerva-live-block"');
    expect(html).not.toContain('Loading…');

    const exported = await test.step('compare against the preview', async () => {
      // Show the exported body inside a shadow root (its own <style> applies,
      // the app's doesn't) — same rows, same order, same columns.
      await win.evaluate((doc) => {
        const host = document.createElement('div');
        host.id = 'export-under-test';
        host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;overflow:auto;padding:24px;';
        const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(doc)![1]!;
        const styles = Array.from(doc.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)).map((m) => m[0]).join('');
        host.attachShadow({ mode: 'open' }).innerHTML = styles + body;
        document.body.appendChild(host);
      }, html);
      return rowTitles(win, '#export-under-test');
    });
    expect(exported).toEqual(preview);
    const tableHeads = await win.evaluate(() => Array.from(document.querySelector('#export-under-test')!.shadowRoot!
      .querySelectorAll('.tv-table thead th')).map((th) => th.textContent.trim()));
    expect(tableHeads[0]).toMatch(/^Title/);
    expect(tableHeads.slice(1)).toEqual(['City']);
    // Rows read as plain text, as in the preview — not as page links styled
    // by the export's stylesheet (underlined, accent-coloured).
    const rowLinkStyles = await win.evaluate(() => Array.from(document.querySelector('#export-under-test')!.shadowRoot!
      .querySelectorAll('.minerva-live-block a')).map((a) => getComputedStyle(a).textDecorationLine));
    expect(rowLinkStyles.length).toBeGreaterThan(0);
    expect(new Set(rowLinkStyles)).toEqual(new Set(['none']));
    await win.locator('#export-under-test').screenshot({ path: 'test-results/export-views-export.png' });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
