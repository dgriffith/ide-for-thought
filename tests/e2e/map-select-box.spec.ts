/**
 * Selecting several pins on a real map (#2939): a ⇧-drag box around two of
 * three pins selects those two (the map doesn't pan or box-zoom while it's
 * drawn), ⌘-click adds the third, and Add Tag… from one pin's menu tags all
 * three. Tiles are served by the test (offline), as in `map-emoji-pins.spec.ts`.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { expectAnnounced, recordAnnouncements } from './helpers/announcements';

const STYLE = { version: 8, sources: {}, layers: [{ id: 'land', type: 'background', paint: { 'background-color': '#e9e4d6' } }] };
const PLACES: Array<[string, string]> = [['Kampa Museum', '50.0835,14.4089'], ['Lokál', '50.0903,14.4258'], ['Lucerna', '50.0815,14.4253']];

test('a ⇧-drag box and ⌘-click select pins, and one menu tags them all (#2939)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-map-box-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-map-box-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  const fileOf = (title: string) => path.join(projectDir, 'places', `${title}.md`);
  fs.mkdirSync(path.join(projectDir, 'places'), { recursive: true });
  for (const [title, location] of PLACES) fs.writeFileSync(fileOf(title), `---\ntype: place\nlocation: "${location}"\n---\n# ${title}\n`);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await win.route('https://tiles.openfreemap.org/styles/**', (route) => route.fulfill({ contentType: 'application/json', body: JSON.stringify(STYLE) }));
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await recordAnnouncements(win);
    await win.locator('.panel-tab[title="Objects"]').first().click();
    await win.getByRole('button', { name: 'Open Place view' }).click({ force: true });
    await win.getByRole('tab', { name: 'Map' }).click();
    const map = win.locator('.type-view-map');
    const pin = (name: string) => map.getByRole('button', { name, exact: true });
    await expect(map.locator('.maplibregl-marker')).toHaveCount(3, { timeout: 15_000 });
    const pressed = () => map.locator('.maplibregl-marker[aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')).sort());
    const centre = async (name: string) => { const b = (await pin(name).boundingBox())!; return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; };

    await test.step('⇧-drag a box around Lokál and Lucerna (the two eastern pins)', async () => {
      const [lokal, lucerna, kampa] = [await centre('Lokál'), await centre('Lucerna'), await centre('Kampa Museum')];
      const left = (kampa.x + Math.min(lokal.x, lucerna.x)) / 2; // between Kampa and the other two
      const top = Math.min(lokal.y, lucerna.y) - 60;
      const bottom = Math.max(lokal.y, lucerna.y) + 40;
      const right = Math.max(lokal.x, lucerna.x) + 40;
      const before = await centre('Kampa Museum');
      await win.keyboard.down('Shift');
      await win.mouse.move(left, top);
      await win.mouse.down();
      await win.mouse.move((left + right) / 2, (top + bottom) / 2, { steps: 5 });
      await win.mouse.move(right, bottom, { steps: 5 });
      await expect(map.locator('.map-select-box')).toBeVisible();
      await win.mouse.up();
      await win.keyboard.up('Shift');
      await expect.poll(pressed).toEqual(['Lokál', 'Lucerna']);
      expect(await centre('Kampa Museum')).toEqual(before); // the map neither panned nor zoomed
      await expectAnnounced(win, '2 selected');
    });

    await test.step('⌘-click adds Kampa Museum; Add Tag… from one pin\'s menu tags all three', async () => {
      await pin('Kampa Museum').click({ modifiers: ['ControlOrMeta'] });
      await expect.poll(pressed).toEqual(['Kampa Museum', 'Lokál', 'Lucerna']);
      await pin('Lucerna').click({ button: 'right' });
      await win.getByRole('menuitem', { name: 'Add Tag… (3 notes)' }).click();
      const input = win.locator('input[aria-labelledby="prompt-dialog-title"]');
      await expect(input).toBeFocused();
      await win.keyboard.type('boxed');
      await win.keyboard.press('Enter');
      for (const [title] of PLACES) await expect.poll(() => fs.readFileSync(fileOf(title), 'utf8')).toContain('boxed');
      await expectAnnounced(win, 'Tagged 3 of 3 notes with "boxed".');
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
