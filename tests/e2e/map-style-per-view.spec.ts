/**
 * A map view's light/dark style is the view's own (#2665): the on-map control
 * restyles it live — same pins, same framing, the new style's credit — and an
 * export of a view saved as dark is captured dark.
 *
 * Both OpenFreeMap styles are served by the test (offline), as in
 * `export-object-view-map.spec.ts`, each with its own credit line so the
 * attribution says which style is actually loaded.
 */
import { test, expect, type Page } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const STYLE_BASE = 'https://tiles.openfreemap.org/styles/';
const style = (credit: string, color: string) => ({
  version: 8,
  sources: { credit: { type: 'geojson', data: { type: 'FeatureCollection', features: [] }, attribution: credit } },
  // A layer must USE the source for MapLibre's attribution control to credit it.
  layers: [
    { id: 'land', type: 'background', paint: { 'background-color': color } },
    { id: 'credit', type: 'circle', source: 'credit' },
  ],
});
const LIGHT = style('© Light Test Tiles', '#e9e4d6');
const DARK = style('© Dark Test Tiles', '#1e1e2e');

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('.minerva/types/place.md', ['---', 'label: Place', 'id: place', 'icon: 📍', 'properties:', '  - name: location', '    type: geo', '    label: Location', '---', ''].join('\n'));
  write('places/Kampa Museum.md', '---\ntype: place\nlocation: "50.0835,14.4089"\n---\n# Kampa Museum\n');
  write('places/Széchenyi Baths.md', '---\ntype: place\nlocation: "47.5186,19.0818"\n---\n# Széchenyi Baths\n');
  write('dark-plan.md', '# Dark plan\n\n```object-view\n{"typeId":"place","layout":"map","mapStyle":"dark"}\n```\n');
}

async function exportNote(win: Page, relativePath: string, outDir: string): Promise<string> {
  const res = await win.evaluate(async ([rel, dir]) => (window as unknown as {
    api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
  }).api.publish.runExport({
    exporterId: 'note-html', input: { kind: 'single-note', relativePath: rel }, outputDir: dir, linkPolicy: 'inline-title',
  }), [relativePath, outDir] as const);
  const file = res!.writtenPaths.find((p) => p.endsWith('.html'))!;
  return fs.readFileSync(path.isAbsolute(file) ? file : path.join(outDir, file), 'utf-8');
}

test('map style: switch live on the map, keep pins and framing, export dark (#2665)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-map-style-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-map-style-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-map-style-out-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    const requested: string[] = [];
    await win.route(`${STYLE_BASE}**`, (route) => {
      const url = route.request().url();
      requested.push(url);
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.includes('/styles/dark') ? DARK : LIGHT) });
    });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const markers = win.locator('.type-view-map .maplibregl-marker');
    const credit = win.locator('.type-view-map .maplibregl-ctrl-attrib-inner');
    const group = win.getByRole('group', { name: 'Map style' });
    const pinBoxes = () => markers.evaluateAll((els) => els.map((e) => { const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y)]; }));

    await test.step('open the Place view as a map, explicitly light', async () => {
      await win.locator('.panel-tab[title="Objects"]').first().click();
      await win.getByRole('button', { name: 'Open Place view' }).click({ force: true });
      await win.getByRole('tab', { name: 'Map' }).click();
      await expect(markers).toHaveCount(2, { timeout: 15_000 });
      await group.getByRole('button', { name: 'Light' }).click();
      await expect(group.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
      await expect(credit).toContainText('© Light Test Tiles', { timeout: 10_000 });
    });
    const before = await pinBoxes();

    await test.step('Dark: restyled in place — same pins, same framing, the dark credit', async () => {
      await group.getByRole('button', { name: 'Dark' }).click();
      await expect(group.getByRole('button', { name: 'Dark' })).toHaveAttribute('aria-pressed', 'true');
      await expect(credit).toContainText('© Dark Test Tiles', { timeout: 10_000 });
      await expect(credit).not.toContainText('© Light Test Tiles');
      await expect(markers).toHaveCount(2);
      expect(await pinBoxes()).toEqual(before);
    });

    await test.step('the keyboard switches it back', async () => {
      await group.getByRole('button', { name: 'Light' }).focus();
      await win.keyboard.press('Enter');
      await expect(group.getByRole('button', { name: 'Light' })).toHaveAttribute('aria-pressed', 'true');
      await expect(credit).toContainText('© Light Test Tiles', { timeout: 10_000 });
      expect(await pinBoxes()).toEqual(before);
    });

    await test.step('a view saved as dark exports dark', async () => {
      requested.length = 0;
      const html = await exportNote(win, 'dark-plan.md', outDir);
      expect(html).toMatch(/<img src="data:image\/png;base64,/);
      expect(html).toContain('<figcaption>© Dark Test Tiles</figcaption>');
      expect(requested.some((u) => u.includes('/styles/dark'))).toBe(true);
      expect(requested.some((u) => u.includes('/styles/liberty'))).toBe(false);
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
