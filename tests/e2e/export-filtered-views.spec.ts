/**
 * Filtered and folder-scoped views embed and export as the preview shows them
 * (#2534, epic #2530): a note embedding a map filtered to city = Prague and a
 * table scoped to one folder shows just those objects in the preview and in
 * the export — the export's map image frames only the filtered places — and
 * neither carries the view panel's filter controls or folder chip.
 *
 * The map style is served by the test (offline), as in
 * `export-object-view-map.spec.ts`.
 */
import { test, expect, type Page } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/';
const STYLE = { version: 8, sources: {}, layers: [{ id: 'land', type: 'background', paint: { 'background-color': '#e9e4d6' } }] };
const PLACES: Array<[string, string, string, string]> = [
  ['prague', 'Kampa Museum', 'Prague', '50.0835,14.4089'],
  ['prague', 'Petřín Tower', 'Prague', '50.0833,14.3950'],
  ['budapest', 'Széchenyi Baths', 'Budapest', '47.5186,19.0818'],
  ['budapest', 'Gellért Baths', 'Budapest', '47.4837,19.0514'],
];

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('.minerva/types/place.md', ['---', 'label: Place', 'id: place', 'icon: 📍', 'properties:', '  - name: city', '    type: text', '    label: City', '  - name: location', '    type: geo', '    label: Location', '---', ''].join('\n'));
  for (const [folder, title, city, loc] of PLACES) write(`trip/${folder}/${title}.md`, `---\ntype: place\ncity: ${city}\nlocation: "${loc}"\n---\n# ${title}\n`);
  write('plan.md', [
    '# Plan', '',
    '```object-view', '{"typeId":"place","layout":"map","filters":[{"property":"city","values":["Prague"]}]}', '```', '',
    '```object-view', '{"typeId":"place","layout":"table","sortColumn":"__title","sortDir":"asc","columns":["city"],"folder":"trip/budapest"}', '```', '',
  ].join('\n'));
}

/** Row titles of each table view under a container (light DOM or a shadow root). */
async function tableRows(win: Page, rootSelector: string): Promise<string[][]> {
  return win.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const scope = (root as HTMLElement).shadowRoot ?? root;
    return Array.from(scope.querySelectorAll('.tv-table')).map((t) =>
      Array.from(t.querySelectorAll('tbody tr td:first-child .tv-cell-title-inner > span:last-child')).map((e) => e.textContent.trim()));
  }, rootSelector);
}

/** Whether any of the view panel's controls rendered under a container. */
async function controlsUnder(win: Page, rootSelector: string): Promise<number> {
  return win.evaluate((sel) => {
    const root = document.querySelector(sel)!;
    const scope = (root as HTMLElement).shadowRoot ?? root;
    return scope.querySelectorAll('.tv-filters, .tv-filter-chip, .tv-chip, .tv-header, .tv-actions').length;
  }, rootSelector);
}

test('filtered and folder-scoped views embed and export with no controls (#2534)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-filtered-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-filtered-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-filtered-out-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await win.route(`${STYLE_URL}**`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(STYLE) }));
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

    const preview = await test.step('the preview shows the filtered map and the folder\'s table', async () => {
      await win.locator('[data-relative-path="plan.md"]').first().click();
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:togglePreview'); });
      await expect(win.locator('.preview .type-view-map .maplibregl-marker')).toHaveCount(2, { timeout: 20_000 });
      await expect(win.locator('.preview .tv-table tbody tr')).toHaveCount(2, { timeout: 15_000 });
      expect(await controlsUnder(win, '.preview')).toBe(0);
      return tableRows(win, '.preview');
    });
    expect(preview).toEqual([['Gellért Baths', 'Széchenyi Baths']]);
    await win.locator('.preview').screenshot({ path: 'test-results/export-filtered-preview.png' });

    const html = await test.step('export through the real pipeline', async () => {
      const res = await win.evaluate(async (dir) => (window as unknown as {
        api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
      }).api.publish.runExport({
        exporterId: 'note-html', input: { kind: 'single-note', relativePath: 'plan.md' }, outputDir: dir, linkPolicy: 'inline-title',
      }), outDir);
      const file = res!.writtenPaths.find((p) => p.endsWith('.html'))!;
      return fs.readFileSync(path.isAbsolute(file) ? file : path.join(outDir, file), 'utf-8');
    });
    expect(html, 'no raw spec in the export').not.toContain('&quot;typeId&quot;');
    // The map image frames only the filtered places.
    const alt = /<img src="data:image\/png;base64,[^"]{2000,}"[^>]*alt="([^"]*)"/.exec(html)?.[1];
    expect(alt).toMatch(/^Map of 2 places: /);
    expect(alt).toContain('Kampa Museum');
    expect(alt).toContain('Petřín Tower');
    expect(alt).not.toContain('Baths');

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
      expect(await controlsUnder(win, '#export-under-test')).toBe(0);
      return tableRows(win, '#export-under-test');
    });
    expect(exported).toEqual(preview);
    await win.locator('#export-under-test').screenshot({ path: 'test-results/export-filtered-export.png' });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
