/**
 * Filter a view by property (#2533, epic #2530): a map of places filtered to
 * city = Prague shows only Prague's markers; the chip removes the filter; and
 * Save as note writes the filter into the note's embed.
 *
 * The map style is served by the test (offline), as in
 * `export-object-view-map.spec.ts`, so CI doesn't depend on a tile provider.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const STYLE_URL = 'https://tiles.openfreemap.org/styles/';
const STYLE = { version: 8, sources: {}, layers: [{ id: 'land', type: 'background', paint: { 'background-color': '#e9e4d6' } }] };

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('.minerva/types/place.md', ['---', 'label: Place', 'id: place', 'icon: 📍', 'properties:', '  - name: city', '    type: text', '    label: City', '  - name: location', '    type: geo', '    label: Location', '---', ''].join('\n'));
  for (const [title, city, loc] of [
    ['Kampa Museum', 'Prague', '50.0835,14.4089'],
    ['Petřín Tower', 'Prague', '50.0833,14.3950'],
    ['Széchenyi Baths', 'Budapest', '47.5186,19.0818'],
  ] as const) write(`places/${title}.md`, `---\ntype: place\ncity: ${city}\nlocation: "${loc}"\n---\n# ${title}\n`);
}

test('a map filtered to Prague shows only Prague; Save as note keeps the filter (#2533)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-view-filter-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-view-filter-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await win.route(`${STYLE_URL}**`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(STYLE) }));
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

    await test.step('open the Place view as a map', async () => {
      await win.locator('.panel-tab[title="Objects"]').first().click();
      await win.getByRole('button', { name: 'Open Place view' }).click({ force: true });
      await win.getByRole('tab', { name: 'Map' }).click();
      await expect(win.locator('.type-view-map .maplibregl-marker')).toHaveCount(3, { timeout: 15_000 });
    });

    await test.step('filter to city = Prague', async () => {
      await win.getByRole('button', { name: 'Filter ▾' }).click();
      const dialog = win.getByRole('dialog', { name: 'Filter by property' });
      await dialog.getByRole('button', { name: 'City' }).click();
      await dialog.getByRole('checkbox', { name: /Prague/ }).check();
      await expect(win.locator('.type-view-map .maplibregl-marker')).toHaveCount(2);
      await expect(win.locator('.tv-count')).toHaveText('2 of 3');
      await expect(win.getByRole('button', { name: 'City: Prague', exact: true })).toBeVisible();
    });

    await test.step('Save as note writes the filter into the embed', async () => {
      await win.keyboard.press('Escape');
      await win.getByRole('button', { name: 'Save as note' }).click();
      await win.locator('input[aria-labelledby="prompt-dialog-title"]').press('Enter'); // accept the suggested name
      const saved = path.join(projectDir, 'Place map.md');
      await expect.poll(() => fs.existsSync(saved), { timeout: 10_000 }).toBe(true);
      const body = fs.readFileSync(saved, 'utf-8');
      const spec = JSON.parse(/```object-view\n([\s\S]*?)\n```/.exec(body)![1]!) as Record<string, unknown>;
      expect(spec).toMatchObject({ typeId: 'place', layout: 'map', filters: [{ property: 'city', values: ['Prague'] }] });
    });

    await test.step('the chip removes the filter', async () => {
      await win.locator('.tab', { hasText: 'Place' }).first().click();
      await win.getByRole('button', { name: 'Remove filter City: Prague' }).click();
      await expect(win.locator('.type-view-map .maplibregl-marker')).toHaveCount(3);
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
