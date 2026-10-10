/**
 * One note holding every live kind the preview renders, exported through the
 * real pipeline (#2515, epic #2508): each kind renders, and not one raw source
 * marker survives into the page. The per-kind specs (`export-*.spec.ts`)
 * compare each against the preview in depth; this one is the net under all of
 * them — the case where kinds interact in one export.
 *
 * It also carries a resized image and a resized map (#2666): the image's
 * `|200` becomes `width="200"` on its `<img>`, and the map is captured in the
 * frame its spec's `height` sets rather than the default 360px.
 *
 * And a Kanban board (#2604): its columns and card titles render, and the
 * no-raw-source check covers its spec too.
 *
 * And a Timeline of Events, one of them a Meeting (#2609, #2612): drawn as
 * SVG in export mode, every event in the drawing and in the dated list after
 * it, and its spec never left behind. It is sized wider than the column
 * (#2709): framed to break out on a screen — measured in a real window on the
 * static site — and drawn to the printable width in a PDF.
 *
 * And a Calendar of the same Events (#2704): the spec's month as a static
 * table, every event in its day's cell, the bar included, and its spec never
 * left behind.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const BASE_URI = 'https://sample.minerva.dev/export-parity-e2e/';
const noteUri = (rel: string) => `${BASE_URI}note/${rel.replace(/\.(md|ttl)$/, '').split('/').map(encodeURIComponent).join('/')}`;
const HIDDEN_CANARY = 'urn:canary:parity-hidden';
// The map style is served by the test, so the capture needs no tile provider.
const STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const OFFLINE_STYLE = {
  version: 8,
  sources: { credit: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: '© Test Tiles contributors' } },
  layers: [{ id: 'land', type: 'background', paint: { 'background-color': '#e9e4d6' } }],
};
// A 1×1 PNG for the resized image.
const PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==';

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('.minerva/config.json', JSON.stringify({ baseUri: BASE_URI }));
  write('.minerva/types/place.md', ['---', 'label: Place', 'id: place', 'icon: 📍', 'properties:', '  - name: city', '    type: text', '    label: City', '---', ''].join('\n'));
  write('places/Kampa Museum.md', '---\ntype: place\ncity: Prague\n---\n# Kampa Museum\n\n#museum\n');
  write('.minerva/types/spot.md', ['---', 'label: Spot', 'id: spot', 'icon: 📌', 'properties:', '  - name: location', '    type: geo', '    label: Location', '---', ''].join('\n'));
  write('spots/Petrin Tower.md', '---\ntype: spot\nlocation: "50.0833,14.3950"\n---\n# Petrin Tower\n');
  // Projects for the board (the stock Project type groups by `status`).
  write('projects/Garden Shed.md', '---\ntype: project\nstatus: active\n---\n# Garden Shed\n');
  write('projects/Tax Return.md', '---\ntype: project\nstatus: done\n---\n# Tax Return\n');
  // Events for the timeline, one of them a Meeting (an Event subtype, #2612).
  write('events/Moon landing.md', '---\ntype: event\ndate: 1969-07-20\n---\n# Moon landing\n');
  write('events/Apollo 11.md', '---\ntype: event\ndate: 1969-07-16\nend: 1969-07-24\n---\n# Apollo 11\n');
  write('meetings/Splashdown debrief.md', '---\ntype: meeting\ndate: 1969-07-25\n---\n# Splashdown debrief\n');
  fs.writeFileSync(path.join(dir, 'pic.png'), Buffer.from(PNG_BASE64, 'base64'));
  write('notes/The Claim.md', '---\ntitle: The Claim\n---\n\n# The Claim\n\n```turtle\nthis: a thought:Claim .\n```\n');
  write('notes/Cited Evidence.md', `---\ntitle: Cited Evidence\nsupports: ${noteUri('notes/The Claim.md')}\n---\n\n# Cited Evidence\n`);
  write('Everything.md', [
    '# Everything', '',
    'Plain text keeps its reading width.', '',
    '```object-view', '{"typeId":"place","layout":"list"}', '```', '',
    '```object-view', '{"typeId":"spot","layout":"map","height":240}', '```', '',
    '```object-view', '{"typeId":"project","layout":"kanban","groupBy":"status"}', '```', '',
    '```object-view', '{"typeId":"event","layout":"timeline","width":1400}', '```', '',
    '```object-view', '{"typeId":"event","layout":"calendar","month":"1969-07"}', '```', '',
    '![shot|200](pic.png)', '',
    '```mermaid', 'graph TD; A[Start] --> B[Finish]', '```', '',
    ':::query-list', 'SELECT ?title ?path WHERE { ?note minerva:hasTag ?t . ?t minerva:tagName "museum" . ?note dc:title ?title . ?note minerva:relativePath ?path . }', ':::', '',
    ':::argument', '[[The Claim]]', ':::', '',
    '```python', 'print(1 + 1)', '```', '', '```output', '{"type":"text","value":"2"}', '```', '',
    '```vega-lite', '{"data":{"values":[{"a":1},{"a":2}]},"mark":"bar","encoding":{"x":{"field":"a","type":"ordinal"},"y":{"field":"a","type":"quantitative"}}}', '```', '',
    '```youtube', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ', '```', '',
    '```turtle-hidden', `<${HIDDEN_CANARY}> <urn:p> "x" .`, '```', '',
    '> [!note] Heads up', '> Callouts render.', '',
    '> [!card] ^c1', '> Capital of Czechia?', '>', '> ---', '>', '> Prague', '',
  ].join('\n'));
}

test('a note with every live kind exports each one rendered, no raw source left (#2515)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-parity-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-parity-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-parity-out-'));
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-parity-site-'));
  const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-export-parity-pdf-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 1000, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await win.route(`${STYLE_URL}*`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(OFFLINE_STYLE) }));
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path="Everything.md"]').first()).toBeVisible({ timeout: 10_000 });

    const html = await test.step('export through the real pipeline', async () => {
      const res = await win.evaluate(async (dir) => (window as unknown as {
        api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
      }).api.publish.runExport({
        exporterId: 'note-html', input: { kind: 'single-note', relativePath: 'Everything.md' }, outputDir: dir, linkPolicy: 'inline-title',
      }), outDir);
      const file = res!.writtenPaths.find((p) => p.endsWith('.html'))!;
      return fs.readFileSync(path.isAbsolute(file) ? file : path.join(outDir, file), 'utf-8');
    });

    await test.step('every kind rendered', async () => {
      expect(html.match(/class="minerva-live-block"/g)?.length, 'object view, map, board, timeline, calendar, mermaid, query, argument map, output').toBe(9);
      expect(html).toContain('Kampa Museum'); // the view's row, and the query's result
      expect(html).toMatch(/<svg[^>]*id="mermaid-export-/); // mermaid
      expect(html).toContain('Cited Evidence'); // the argument map's node
      // The Kanban board, in export mode: its columns, and every card title.
      expect(html).toMatch(/class="kb-board[^"]*\bkb-export\b/);
      expect([...html.matchAll(/class="kb-col-label[^"]*">([^<]+)</g)].map((m) => m[1])).toEqual(['active', 'paused', 'done', 'abandoned']);
      expect(html).toContain('Garden Shed');
      expect(html).toContain('Tax Return');
      // The Timeline, in export mode: an SVG drawing with every event in it, the Meeting included, then the dated list.
      expect(html).toMatch(/class="tl[^"]*\btl-export\b/);
      const drawing = /<svg[^>]*class="tl-plot[\s\S]*?<\/svg>/.exec(html)?.[0] ?? '';
      for (const title of ['Moon landing', 'Apollo 11', 'Splashdown debrief']) {
        expect(drawing, `${title} drawn`).toContain(title);
        expect(html, `${title} listed`).toMatch(new RegExp(`class="tl-list-title[^"]*">${title}<`));
      }
      // The Calendar, in export mode: July 1969 as a static table, each event in its cell (Apollo 11 as a bar).
      expect(html).toMatch(/class="cal[^"]*\bcal-export\b/);
      expect(html).toMatch(/<div role="table" class="calx\b[^"]*" aria-label="July 1969"/);
      for (const title of ['Moon landing', 'Apollo 11', 'Splashdown debrief']) {
        expect(html, `${title} in its cell`).toMatch(new RegExp(`class="calx-title[^"]*">${title}<`));
      }
      expect(html).not.toContain('role="grid"');
      expect(html).toContain('compute-output-text'); // the saved output
      expect(html).toMatch(/<img[^>]+src="data:image\/svg\+xml/); // the vega-lite chart
      expect(html).toContain('youtube'); // the linked thumbnail
      expect(html).toContain('callout-note');
      expect(html).toContain('callout-card');
      expect(html).toContain('Prague'); // the flashcard's answer is shown
    });

    await test.step('sizes carry through (#2666)', async () => {
      // The map's frame is its spec's 240px, inside the 1px border: 758×238.
      expect(html).toMatch(/<img src="data:image\/png;base64,[A-Za-z0-9+/=]{200,}" width="758" height="238"/);
      expect(html).toContain('<img src="pic.png" alt="shot" width="200">');
      expect(html).not.toContain('shot|200');
      // The timeline's width (#2709): a frame that breaks out of the column.
      expect(html).toContain('<div class="minerva-live-frame" data-breakout="1" style="width:min(1400px, max(100%, calc((100cqw + 100%) / 2 - 32px)));margin:1em 0">');
    });

    await test.step('static site: the wide timeline breaks out of the article, the text doesn\'t, and the page never scrolls sideways (#2709)', async () => {
      await win.evaluate(async (dir) => (window as unknown as {
        api: { publish: { runExport(a: unknown): Promise<unknown> } };
      }).api.publish.runExport({ exporterId: 'static-site', input: { kind: 'project' }, outputDir: dir }), siteDir);
      // A CI runner's display is ~1024px wide and a window is clamped to it,
      // so a wide page is a window at half zoom: 1000 device px, ~2000 CSS px.
      const measure = (zoomFactor: number) => app.evaluate(async ({ BrowserWindow }, { file, zoomFactor }) => {
        const w = new BrowserWindow({ show: false, width: 1000, height: 800 });
        try {
          await w.loadFile(file);
          // Set after loading, every time: Electron shares a zoom level across
          // an origin's pages, so one window's zoom would carry to the next.
          w.webContents.setZoomFactor(zoomFactor);
          await w.webContents.executeJavaScript('new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)))');
          return await w.webContents.executeJavaScript(`(() => {
            const frame = document.querySelector('.minerva-live-frame').getBoundingClientRect();
            const p = [...document.querySelectorAll('article p')].find((el) => el.textContent === 'Plain text keeps its reading width.').getBoundingClientRect();
            const de = document.documentElement;
            return { frame: Math.round(frame.width), frameLeft: Math.round(frame.left), frameRight: Math.round(frame.right),
              text: Math.round(p.width), textLeft: Math.round(p.left), viewport: de.clientWidth, pageScrolls: de.scrollWidth > de.clientWidth };
          })()`) as { frame: number; frameLeft: number; frameRight: number; text: number; textLeft: number; viewport: number; pageScrolls: boolean };
        } finally {
          w.destroy();
        }
      }, { file: path.join(siteDir, 'Everything.html'), zoomFactor });
      // A wide window: past the text, left-aligned with it, short of the window's edge.
      const wide = await measure(0.5);
      expect(wide.frame, JSON.stringify(wide)).toBeGreaterThan(wide.text + 200);
      expect(wide.frameLeft).toBe(wide.textLeft);
      expect(wide.frameRight).toBeLessThanOrEqual(wide.viewport - 32);
      expect(wide.pageScrolls).toBe(false);
      // A window with no room beside the text: as wide as the text, scrolling itself.
      const narrow = await measure(1);
      expect(narrow.frame, JSON.stringify(narrow)).toBe(narrow.text);
      expect(narrow.pageScrolls).toBe(false);
    });

    await test.step('note PDF: the wide timeline is drawn to the printable width (#2709)', async () => {
      const res = await win.evaluate(async (dir) => (window as unknown as {
        api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
      }).api.publish.runExport({
        exporterId: 'note-pdf', input: { kind: 'single-note', relativePath: 'Everything.md' }, outputDir: dir, linkPolicy: 'inline-title',
      }), pdfDir);
      const pdf = res!.writtenPaths.find((p) => p.endsWith('.pdf'))!;
      const abs = path.isAbsolute(pdf) ? pdf : path.join(pdfDir, pdf);
      expect(fs.statSync(abs).size).toBeGreaterThan(5_000);
      fs.copyFileSync(abs, 'test-results/export-parity-all-kinds.pdf');
    });

    await test.step('no raw source survives', async () => {
      for (const marker of ['```', ':::query', ':::argument', '[!note]', '[!card]', '&quot;typeId&quot;', '&quot;kanban&quot;', '&quot;timeline&quot;', '&quot;calendar&quot;', '|200', '{&quot;type&quot;:&quot;text&quot;', 'graph TD;', HIDDEN_CANARY]) {
        expect(html, `raw "${marker}" in the export`).not.toContain(marker);
      }
      expect(html).not.toContain('couldn&#39;t be rendered for export');
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir, siteDir, pdfDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
