/**
 * Object views are on the back/forward stack: click a pin on a map view, read
 * the note, go Back — you're on the map again, as you left it; Forward returns
 * to the note.
 *
 * The map style is served by the test (offline), as in
 * `export-object-view-map.spec.ts`.
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
  write('.minerva/types/place.md', ['---', 'label: Place', 'id: place', 'icon: 📍', 'properties:', '  - name: location', '    type: geo', '    label: Location', '---', ''].join('\n'));
  write('places/Kampa Museum.md', '---\ntype: place\nlocation: "50.0835,14.4089"\n---\n# Kampa Museum\n\nOn the island.\n');
  write('places/Széchenyi Baths.md', '---\ntype: place\nlocation: "47.5186,19.0818"\n---\n# Széchenyi Baths\n');
}

test('map pin → note → Back returns to the map, Forward to the note', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-view-nav-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-view-nav-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  const menu = (channel: string) => app.evaluate(({ BrowserWindow }, ch) => { BrowserWindow.getAllWindows()[0]!.webContents.send(ch); }, channel);
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await win.route(`${STYLE_URL}**`, (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(STYLE) }));
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const markers = win.locator('.type-view-map .maplibregl-marker');
    const activeTab = win.locator('.tab.active');

    await test.step('open the Place view as a map', async () => {
      await win.locator('.panel-tab[title="Objects"]').first().click();
      await win.getByRole('button', { name: 'Open Place view' }).click({ force: true });
      await win.getByRole('tab', { name: 'Map' }).click();
      await expect(markers).toHaveCount(2, { timeout: 15_000 });
    });

    await test.step('click a pin: the note opens', async () => {
      await markers.first().click();
      await expect(activeTab).toContainText(/Kampa Museum|Széchenyi Baths/, { timeout: 10_000 });
    });
    const noteTitle = (await activeTab.textContent())!.includes('Kampa') ? 'Kampa Museum' : 'Széchenyi Baths';

    await test.step('Back: the map again, still a map', async () => {
      await menu('menu:navBack');
      await expect(activeTab).toContainText('Place', { timeout: 10_000 });
      await expect(win.getByRole('tab', { name: 'Map' })).toHaveAttribute('aria-selected', 'true');
      await expect(markers).toHaveCount(2, { timeout: 15_000 });
    });

    await test.step('Forward: the note again', async () => {
      await menu('menu:navForward');
      await expect(activeTab).toContainText(noteTitle, { timeout: 10_000 });
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
