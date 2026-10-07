/**
 * Map pins show their object type's icon (#2711): a Place map holding a Place
 * (📍), a Restaurant (🍕) and a Venue (no icon) — two icon pins in their
 * types' colours and one stock pin — live on light and dark tiles, and in the
 * exported image. Tiles are served by the test (offline), as in
 * `map-style-per-view.spec.ts`. Screenshots and the exported image and PDF
 * are kept in `test-results/`.
 */
import { test, expect, type Page } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const STYLE_BASE = 'https://tiles.openfreemap.org/styles/';
const style = (color: string) => ({ version: 8, sources: {}, layers: [{ id: 'land', type: 'background', paint: { 'background-color': color } }] });
const LIGHT = style('#e9e4d6');
const DARK = style('#1e1e2e');

const BLUE = '#1e66f5'; // Place
const GREEN = '#40a02b'; // Restaurant
const PURPLE = '#8839ef'; // Venue — no icon

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  const type = (id: string, label: string, extra: string[]) => write(`.minerva/types/${id}.md`, ['---', `label: ${label}`, `id: ${id}`, ...extra, 'properties:', '  - name: location', '    type: geo', '    label: Location', '---', ''].join('\n'));
  type('place', 'Place', ['icon: 📍', `color: "${BLUE}"`]);
  type('restaurant', 'Restaurant', ['parent: place', 'icon: 🍕', `color: "${GREEN}"`]);
  type('venue', 'Venue', ['parent: place', `color: "${PURPLE}"`]);
  write('places/Kampa Museum.md', '---\ntype: place\nlocation: "50.0835,14.4089"\n---\n# Kampa Museum\n');
  write('places/Lokál.md', '---\ntype: restaurant\nlocation: "50.0903,14.4258"\n---\n# Lokál\n');
  write('places/Lucerna.md', '---\ntype: venue\nlocation: "50.0815,14.4253"\n---\n# Lucerna\n');
  write('pins.md', '# Pins\n\n```object-view\n{"typeId":"place","layout":"map","mapStyle":"light"}\n```\n');
}

async function runExport(win: Page, exporterId: string, outDir: string): Promise<string[]> {
  const res = await win.evaluate(async ([id, dir]) => (window as unknown as {
    api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
  }).api.publish.runExport({
    exporterId: id, input: { kind: 'single-note', relativePath: 'pins.md' }, outputDir: dir, linkPolicy: 'inline-title',
  }), [exporterId, outDir] as const);
  return res!.writtenPaths.map((p) => (path.isAbsolute(p) ? p : path.join(outDir, p)));
}

/** Pixel counts in a PNG data URL, decoded by the page's own canvas. */
async function colourCounts(win: Page, dataUrl: string, targets: Record<string, string>): Promise<Record<string, number>> {
  return win.evaluate(async ([src, want]) => {
    const img = new Image();
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = src; });
    const c = document.createElement('canvas');
    c.width = img.naturalWidth;
    c.height = img.naturalHeight;
    const ctx = c.getContext('2d')!;
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, c.width, c.height).data;
    const rgb = Object.fromEntries(Object.entries(want).map(([k, hex]) => [k, [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))]));
    const out: Record<string, number> = Object.fromEntries(Object.keys(want).map((k) => [k, 0]));
    out.white = 0;
    out.emojiRed = 0; // 📍's red head, a colour no tile or pin here has
    for (let i = 0; i < d.length; i += 4) {
      const [r, g, b] = [d[i]!, d[i + 1]!, d[i + 2]!];
      for (const [k, [tr, tg, tb]] of Object.entries(rgb)) if (Math.abs(r - tr!) + Math.abs(g - tg!) + Math.abs(b - tb!) < 24) out[k]!++;
      if (r > 250 && g > 250 && b > 250) out.white++;
      if (r > 170 && g < 90 && b < 90) out.emojiRed++;
    }
    return out;
  }, [dataUrl, targets] as const);
}

test('map pins carry their type\'s emoji, live and in an export (#2711)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-map-pins-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-map-pins-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-map-pins-out-'));
  const pdfDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-map-pins-pdf-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await win.route(`${STYLE_BASE}**`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(route.request().url().includes('/styles/dark') ? DARK : LIGHT) }));
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const wrap = win.locator('.type-view-map-wrap');
    const markers = win.locator('.type-view-map .maplibregl-marker');
    const group = win.getByRole('group', { name: 'Map style' });
    const pinBoxes = () => markers.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; }));

    await test.step('the live map: icon pins named by their titles, and a stock pin', async () => {
      await win.locator('.panel-tab[title="Objects"]').first().click();
      await win.getByRole('button', { name: 'Open Place view' }).click({ force: true });
      await win.getByRole('tab', { name: 'Map' }).click();
      await expect(markers).toHaveCount(3, { timeout: 15_000 });
      await group.getByRole('button', { name: 'Light' }).click();
      const map = win.locator('.type-view-map');
      await expect(map.getByRole('img', { name: 'Kampa Museum' })).toContainText('📍');
      await expect(map.getByRole('img', { name: 'Lokál' })).toContainText('🍕');
      await expect(map.getByRole('img', { name: 'Kampa Museum' }).locator('svg g[fill="#1e66f5"]')).toHaveCount(1);
      // The icon-less Venue is MapLibre's own pin: no custom element, no text.
      const stock = markers.filter({ hasNot: win.locator('text') });
      await expect(win.locator('.type-view-map .minerva-emoji-pin')).toHaveCount(2);
      await expect(stock).toHaveCount(1);
      await expect(stock.locator(`svg g[fill="${PURPLE}"]`)).toHaveCount(1);
      await wrap.screenshot({ path: 'test-results/map-pins-light.png' });
    });

    await test.step('dark tiles: same pins, same places, emoji intact', async () => {
      const before = await pinBoxes();
      await group.getByRole('button', { name: 'Dark' }).click();
      await expect(wrap).toHaveClass(/dark-tiles/);
      await expect(markers).toHaveCount(3);
      await expect(win.locator('.type-view-map .minerva-emoji-pin text')).toHaveText(['📍', '🍕']);
      expect(await pinBoxes()).toEqual(before);
      await win.waitForTimeout(500); // let the dark style paint before the screenshot
      await wrap.screenshot({ path: 'test-results/map-pins-dark.png' });
    });

    await test.step('the HTML export draws every pin, the emoji included', async () => {
      const file = (await runExport(win, 'note-html', outDir)).find((p) => p.endsWith('.html'))!;
      const html = fs.readFileSync(file, 'utf-8');
      const src = /<img src="(data:image\/png;base64,[A-Za-z0-9+/=]+)"/.exec(html)?.[1];
      expect(src, 'the map was captured as an image').toBeDefined();
      fs.writeFileSync('test-results/map-pins-export.png', Buffer.from(src!.split(',')[1]!, 'base64'));
      const counts = await colourCounts(win, src!, { blue: BLUE, green: GREEN, purple: PURPLE });
      expect(counts.blue, JSON.stringify(counts)).toBeGreaterThan(50);
      expect(counts.green).toBeGreaterThan(50);
      expect(counts.purple).toBeGreaterThan(50); // the stock pin, too
      expect(counts.white).toBeGreaterThan(300); // the light discs
      expect(counts.emojiRed).toBeGreaterThan(20); // 📍 really drawn, not a blank disc
    });

    await test.step('the PDF export prints', async () => {
      const pdf = (await runExport(win, 'note-pdf', pdfDir)).find((p) => p.endsWith('.pdf'));
      expect(pdf).toBeDefined();
      expect(fs.statSync(pdf!).size).toBeGreaterThan(5_000);
      fs.copyFileSync(pdf!, 'test-results/map-pins-export.pdf');
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir, pdfDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
