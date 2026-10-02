/**
 * View a folder's objects from the Notes sidebar (#2532, epic #2530): right-
 * click a folder → View Objects ▸ → Place opens a Place view of only that
 * folder's places (recursively), titled with the folder; its chip widens it.
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
  write('.minerva/types/place.md', ['---', 'label: Place', 'id: place', 'icon: 📍', 'properties:', '  - name: city', '    type: text', '    label: City', '---', ''].join('\n'));
  write('trip/prague/Kampa Museum.md', '---\ntype: place\ncity: Prague\n---\n# Kampa Museum\n');
  write('trip/prague/old town/Astronomical Clock.md', '---\ntype: place\ncity: Prague\n---\n# Astronomical Clock\n');
  write('trip/budapest/Széchenyi Baths.md', '---\ntype: place\ncity: Budapest\n---\n# Széchenyi Baths\n');
}

test('a folder\'s right-click menu opens a view of just its objects (#2532)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-folder-view-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-folder-view-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await win.locator('[data-relative-path="trip"]').first().click();

    await test.step('right-click the folder → View Objects ▸ → Place', async () => {
      await win.locator('[data-relative-path="trip/prague"]').first().click({ button: 'right' });
      const trigger = win.getByRole('button', { name: 'View Objects' });
      await trigger.focus(); // keyboard-reachable: :focus-within opens the submenu
      const menu = win.getByRole('menu', { name: 'View objects in trip/prague' });
      await expect(menu.getByRole('menuitem')).toHaveText([/Place\s*2/]);
      await menu.getByRole('menuitem', { name: /Place/ }).click();
    });

    await test.step('a Place view of only that folder', async () => {
      await expect(win.locator('.tab', { hasText: 'Place · trip/prague' }).first()).toBeVisible({ timeout: 10_000 });
      await expect(win.locator('.tv-table tbody tr')).toHaveCount(2, { timeout: 10_000 });
      await expect(win.locator('.tv-table')).toContainText('Kampa Museum');
      await expect(win.locator('.tv-table')).toContainText('Astronomical Clock'); // a subfolder's note
      await expect(win.locator('.tv-table')).not.toContainText('Széchenyi Baths');
      await expect(win.locator('.tv-count')).toHaveText('2 of 3');
    });

    await test.step('the chip widens it to the whole thoughtbase', async () => {
      await win.getByRole('button', { name: 'Show Place from the whole thoughtbase' }).click();
      await expect(win.locator('.tv-table tbody tr')).toHaveCount(3, { timeout: 10_000 });
      await expect(win.locator('.tv-count')).toHaveText('3');
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
