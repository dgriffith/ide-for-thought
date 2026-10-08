/**
 * Filter a view by subtype (#2716): a map of Places filtered to Restaurants
 * shows only Restaurant pins — the Pizzeria too, a Restaurant subtype — and
 * Save as note writes the filter into an embed that shows the same pins.
 *
 * The map style is served by the test (offline), as in
 * `view-property-filters.spec.ts`, so CI doesn't depend on a tile provider.
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
  const type = (id: string, label: string, icon: string, parent?: string) => write(`.minerva/types/${id}.md`, [
    '---', `label: ${label}`, `id: ${id}`, `icon: ${icon}`, ...(parent ? [`parent: ${parent}`] : []),
    ...(parent ? [] : ['properties:', '  - name: location', '    type: geo', '    label: Location']), '---', '',
  ].join('\n'));
  type('place', 'Place', '📍');
  type('restaurant', 'Restaurant', '🍽', 'place');
  type('pizzeria', 'Pizzeria', '🍕', 'restaurant');
  type('museum', 'Museum', '🏛', 'place');
  for (const [title, t, loc] of [
    ['Kampa Museum', 'museum', '50.0835,14.4089'],
    ['Lokál', 'restaurant', '50.0903,14.4258'],
    ['Pizza Nuova', 'pizzeria', '50.0893,14.4295'],
    ['Petřín Tower', 'place', '50.0833,14.3950'],
  ] as const) write(`places/${title}.md`, `---\ntype: ${t}\nlocation: "${loc}"\n---\n# ${title}\n`);
}

test('a Place map filtered to Restaurants shows Restaurant pins; the saved embed shows the same (#2716)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-subtype-filter-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-subtype-filter-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await win.route(`${STYLE_URL}**`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(STYLE) }));
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const liveMap = win.locator('.type-view-map').first();

    await test.step('open the Place view as a map: every place and subtype', async () => {
      await win.locator('.panel-tab[title="Objects"]').first().click();
      await win.getByRole('button', { name: 'Open Place view' }).click({ force: true });
      await win.getByRole('tab', { name: 'Map' }).click();
      await expect(liveMap.locator('.maplibregl-marker')).toHaveCount(4, { timeout: 15_000 });
    });

    await test.step('filter Type to Restaurant: the Restaurant and its Pizzeria', async () => {
      await win.getByRole('button', { name: 'Filter ▾' }).click();
      const dialog = win.getByRole('dialog', { name: 'Filter by property' });
      await dialog.getByRole('button', { name: 'Type' }).click();
      const tree = dialog.getByRole('list', { name: 'Subtypes' });
      await expect(tree.getByRole('checkbox')).toHaveCount(3); // Museum, Restaurant → Pizzeria
      await tree.getByRole('checkbox', { name: /Restaurant/ }).check();
      await expect(liveMap.locator('.maplibregl-marker')).toHaveCount(2);
      await expect(liveMap.getByRole('img', { name: 'Lokál' })).toBeVisible();
      await expect(liveMap.getByRole('img', { name: 'Pizza Nuova' })).toBeVisible();
      await expect(win.locator('.tv-count')).toHaveText('2 of 4');
      await expect(win.getByRole('button', { name: 'Type: Restaurant', exact: true })).toBeVisible();
    });

    await test.step('Save as note writes the filter, and the embed shows the same pins', async () => {
      await win.keyboard.press('Escape');
      await win.getByRole('button', { name: 'Save as note' }).click();
      await win.locator('input[aria-labelledby="prompt-dialog-title"]').press('Enter'); // accept the suggested name
      const saved = path.join(projectDir, 'Place map.md');
      await expect.poll(() => fs.existsSync(saved), { timeout: 10_000 }).toBe(true);
      const spec = JSON.parse(/```object-view\n([\s\S]*?)\n```/.exec(fs.readFileSync(saved, 'utf-8'))![1]!) as Record<string, unknown>;
      expect(spec).toMatchObject({ typeId: 'place', layout: 'map', filters: [{ property: 'type', values: ['restaurant'] }] });

      await win.getByRole('button', { name: 'Side by side', exact: true }).click();
      const embed = win.locator('.preview').first().locator('.object-view-block[data-object-view-rendered="ok"]');
      await expect(embed.locator('.maplibregl-marker')).toHaveCount(2, { timeout: 15_000 });
      await expect(embed.getByRole('img', { name: 'Lokál' })).toBeAttached();
      await expect(embed.getByRole('img', { name: 'Pizza Nuova' })).toBeAttached();
      await expect(embed.locator('.tv-filters')).toHaveCount(0); // read-only
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
