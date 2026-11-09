/**
 * A map's pins from the keyboard (#2934): Tab onto the map, Tab again onto
 * its pins, step between them with the arrows (west → east), and tag one from
 * its note menu (Shift+F10) — no pointer for any of it — in the type's tab and
 * in a note's embedded map. Tiles are served by the test (offline), as in
 * `map-emoji-pins.spec.ts`; the pins draw without them.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { expectAnnounced, recordAnnouncements } from './helpers/announcements';

const STYLE = { version: 8, sources: {}, layers: [{ id: 'land', type: 'background', paint: { 'background-color': '#e9e4d6' } }] };

// West → east: Kampa Museum, Lucerna, Lokál.
const PLACES: Array<[string, string]> = [['Kampa Museum', '50.0835,14.4089'], ['Lokál', '50.0903,14.4258'], ['Lucerna', '50.0815,14.4253']];

test('step between map pins and tag one, without a pointer, in the panel and in an embed (#2934)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-map-kbd-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-map-kbd-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  const fileOf = (title: string) => path.join(projectDir, 'places', `${title}.md`);
  fs.mkdirSync(path.join(projectDir, 'places'), { recursive: true });
  for (const [title, location] of PLACES) fs.writeFileSync(fileOf(title), `---\ntype: place\nlocation: "${location}"\n---\n# ${title}\n`);
  fs.writeFileSync(path.join(projectDir, 'Pins.md'), '# Pins\n\n```object-view\n{"typeId":"place","layout":"map","mapStyle":"light"}\n```\n');
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await win.route('https://tiles.openfreemap.org/styles/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(STYLE) }));
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await recordAnnouncements(win);
    const promptInput = win.locator('input[aria-labelledby="prompt-dialog-title"]');
    const tag = async (text: string) => {
      await win.keyboard.press('Shift+F10');
      await expect(win.getByRole('menuitem', { name: /^Add Tag/ })).toBeFocused();
      await win.keyboard.press('Enter');
      await expect(promptInput).toBeFocused();
      await win.keyboard.type(text);
      await win.keyboard.press('Enter');
    };

    await test.step('the panel: Tab to the map, Tab to its pins, → to the next, Shift+F10 → Add Tag…', async () => {
      await win.locator('.panel-tab[title="Objects"]').first().click();
      await win.getByRole('button', { name: 'Open Place view' }).click({ force: true });
      await win.getByRole('tab', { name: 'Map' }).click();
      const map = win.locator('.type-view-map');
      await expect(map.locator('.maplibregl-marker')).toHaveCount(3, { timeout: 15_000 });
      // The map's one tab stop is MapLibre's canvas, named for its places.
      const canvas = map.locator('canvas.maplibregl-canvas');
      await expect(canvas).toHaveAttribute('aria-label', 'Place map, 3 places');
      await canvas.focus();
      await win.keyboard.press('Tab');
      await expect(map.getByRole('button', { name: 'Kampa Museum' })).toBeFocused(); // the westernmost
      await win.keyboard.press('ArrowRight');
      await expect(map.getByRole('button', { name: 'Lucerna' })).toBeFocused();
      await expect(win.getByRole('tooltip')).toBeVisible(); // its preview, on focus
      await tag('from-the-map');
      await expect.poll(() => fs.readFileSync(fileOf('Lucerna'), 'utf8')).toContain('from-the-map');
      expect(fs.readFileSync(fileOf('Kampa Museum'), 'utf8')).not.toContain('from-the-map');
      await expectAnnounced(win, 'Tagged 1 of 1 note with "from-the-map".');
    });

    await test.step("a note's embedded map: the same keys, the same menu", async () => {
      await win.locator('.panel-tab[title="Notes"]').first().click();
      await win.locator('[data-relative-path="Pins.md"]').first().click();
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'view.togglePreview'); });
      const map = win.locator('.preview .object-view-block .type-view-map');
      await expect(map.locator('.maplibregl-marker')).toHaveCount(3, { timeout: 15_000 });
      await map.locator('canvas.maplibregl-canvas').focus();
      await win.keyboard.press('Tab');
      await expect(map.getByRole('button', { name: 'Kampa Museum' })).toBeFocused();
      await win.keyboard.press('End');
      await expect(map.getByRole('button', { name: 'Lokál' })).toBeFocused(); // the easternmost
      await tag('in-an-embed');
      await expect.poll(() => fs.readFileSync(fileOf('Lokál'), 'utf8')).toContain('in-an-embed');
      await expectAnnounced(win, 'Tagged 1 of 1 note with "in-an-embed".');
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
