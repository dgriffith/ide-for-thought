/**
 * A map view on a machine with no WebGL2 lists its places instead (#3011).
 *
 * The Linux e2e leg (#2179) found it: under Xvfb there's no GPU, MapLibre
 * threw from its constructor, and the view was an empty box. This launches
 * with the GPU and the software rasterizer both off — no WebGL on any OS,
 * whatever SOFTWARE_GL_LAUNCH_ARGS permits — and checks the fallback in the
 * real app: one line saying why, the located places, and a row opening its
 * note. The export side is covered by TypeViewMap-no-webgl.test.ts.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

function seed(dir: string): void {
  const write = (rel: string, content: string) => {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  };
  write('.minerva/types/place.md', ['---', 'label: Place', 'id: place', 'icon: 📍', 'properties:', '  - name: location', '    type: geo', '    label: Location', '---', ''].join('\n'));
  write('places/Kampa Museum.md', '---\ntype: place\nlocation: "50.0835,14.4089"\n---\n# Kampa Museum\n\nOn the island.\n');
  write('places/Széchenyi Baths.md', '---\ntype: place\nlocation: "47.5186,19.0818"\n---\n# Széchenyi Baths\n');
}

test('with no WebGL2, a map view lists its places and says why (#3011)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-map-nogl-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-map-nogl-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' }, args: ['--disable-gpu', '--disable-software-rasterizer'] });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

    await test.step('open the Place view as a map: the places, not a map', async () => {
      await win.locator('.panel-tab[title="Objects"]').first().click();
      await win.getByRole('button', { name: 'Open Place view' }).click({ force: true });
      await win.getByRole('tab', { name: 'Map' }).click();
      await expect(win.locator('.map-unavailable-note')).toContainText('WebGL2', { timeout: 15_000 });
      await expect(win.locator('.map-places .map-place')).toHaveCount(2);
      await expect(win.locator('.type-view-map')).toHaveCount(0);
    });

    await test.step('a row opens its note', async () => {
      await win.locator('.map-place', { hasText: 'Kampa Museum' }).click();
      await expect(win.locator('.tab.active')).toContainText('Kampa Museum', { timeout: 10_000 });
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
