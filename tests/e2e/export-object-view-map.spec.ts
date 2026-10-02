/**
 * Object-view maps export as an image framed like the preview (#2511, epic
 * #2508) — or as their places, when the map can't be drawn.
 *
 * Real MapLibre in the real app. The map style is served by the test (an
 * offline style), so the result doesn't depend on a tile provider being
 * reachable from CI: one style draws fully offline; the other points its tiles
 * at a closed local port, so they fail fast.
 */
import { test, expect, type Page } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const PLACES: Array<[string, string]> = [
  ['Kampa Museum', '50.0835,14.4089'],
  ['Petřín Tower', '50.0833,14.3950'],
  ['Széchenyi Baths', '47.5186,19.0818'],
];

const DRAWABLE_STYLE = {
  version: 8,
  sources: { credit: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: '© Test Tiles contributors' } },
  layers: [{ id: 'land', type: 'background', paint: { 'background-color': '#e9e4d6' } }],
};
const UNDRAWABLE_STYLE = {
  version: 8,
  sources: { tiles: { type: 'vector', tiles: ['http://127.0.0.1:9/{z}/{x}/{y}.pbf'], maxzoom: 14 } },
  layers: [
    { id: 'land', type: 'background', paint: { 'background-color': '#e9e4d6' } },
    { id: 'water', type: 'fill', source: 'tiles', 'source-layer': 'water', paint: { 'fill-color': '#aac' } },
  ],
};

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('.minerva/types/place.md', ['---', 'label: Place', 'id: place', 'icon: 📍', 'properties:', '  - name: location', '    type: geo', '    label: Location', '---', ''].join('\n'));
  for (const [title, loc] of PLACES) write(`trip/places/${title}.md`, `---\ntype: place\nlocation: "${loc}"\n---\n# ${title}\n`);
  write('trip/plan.md', '# Plan\n\n```object-view\n{"typeId":"place","layout":"map"}\n```\n');
}

async function exportPlan(win: Page, outDir: string): Promise<string> {
  const res = await win.evaluate(async (dir) => (window as unknown as {
    api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
  }).api.publish.runExport({
    exporterId: 'note-html', input: { kind: 'single-note', relativePath: 'trip/plan.md' }, outputDir: dir, linkPolicy: 'inline-title',
  }), outDir);
  const file = res!.writtenPaths.find((p) => p.endsWith('.html'))!;
  return fs.readFileSync(path.isAbsolute(file) ? file : path.join(outDir, file), 'utf-8');
}

/** Show an exported page's body in a shadow root and screenshot it. */
async function showExport(win: Page, html: string, shot: string): Promise<void> {
  await win.evaluate((doc) => {
    document.querySelector('#export-under-test')?.remove();
    const host = document.createElement('div');
    host.id = 'export-under-test';
    host.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#fff;overflow:auto;padding:24px;';
    const body = /<body[^>]*>([\s\S]*)<\/body>/i.exec(doc)![1]!;
    const styles = Array.from(doc.matchAll(/<style[^>]*>[\s\S]*?<\/style>/gi)).map((m) => m[0]).join('');
    host.attachShadow({ mode: 'open' }).innerHTML = styles + body;
    document.body.appendChild(host);
  }, html);
  await win.locator('#export-under-test').screenshot({ path: shot });
}

for (const [name, style] of [['drawn', DRAWABLE_STYLE], ['undrawable', UNDRAWABLE_STYLE]] as const) {
  test(`object-view map exports as ${name === 'drawn' ? 'an image with its pins and credit' : 'its places when tiles fail'} (#2511)`, async () => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-map-userdata-'));
    const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-map-project-'));
    const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-map-out-'));
    fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
    seed(projectDir);
    fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
    const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
    try {
      const win = await app.firstWindow({ timeout: 20_000 });
      await win.route(`${STYLE_URL}*`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(style) }));
      await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
      await expect(win.locator('[data-relative-path="trip"]').first()).toBeVisible({ timeout: 10_000 });

      const html = await test.step('export the note', () => exportPlan(win, outDir));
      expect(html).not.toContain('&quot;typeId&quot;');
      if (name === 'drawn') {
        // The map's own area inside the preview frame's 1px border: 758×358.
        expect(html).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]{2000,}" width="758" height="358"/);
        expect(html).toContain('alt="Map of 3 places: ');
        expect(html).toContain('<figcaption>© Test Tiles contributors</figcaption>');
        expect(html).not.toContain('<table');
      } else {
        expect(html).not.toContain('data:image/png');
        expect(html).toContain("The map couldn't be drawn for this export (the map tiles could not be loaded");
        for (const [title] of PLACES) expect(html).toContain(`>${title}</a></td>`);
        expect(html).toContain('<td class="num">50.08350</td><td class="num">14.40890</td>');
      }
      await showExport(win, html, `test-results/export-map-${name}.png`);
      if (name === 'drawn') {
        // The image fills its frame: no page-stylesheet margin letterboxing it.
        const gap = await win.evaluate(() => {
          const root = document.querySelector('#export-under-test')!.shadowRoot!;
          const fig = root.querySelector('figure.minerva-live-map')!.getBoundingClientRect();
          const img = root.querySelector('figure.minerva-live-map img')!.getBoundingClientRect();
          return Math.round(img.top - fig.top);
        });
        expect(gap).toBeLessThanOrEqual(1);
      }
    } finally {
      await closeMinerva(app);
      for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
    }
  });
}
