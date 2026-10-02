/**
 * The Notes panel's root menu offers the folder actions that make sense for
 * the thoughtbase itself: Copy Path, Open In, View Objects, Label Version and
 * View Local History — not just New Note / New Folder.
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
  write('Kampa.md', '---\ntype: place\ncity: Prague\n---\n# Kampa\n'); // at the root itself
  write('trip/Gerbeaud.md', '---\ntype: place\ncity: Budapest\n---\n# Gerbeaud\n');
}

test('the root folder\'s menu has Copy Path, Open In, View Objects and history', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-root-menu-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-root-menu-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seed(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const rootRow = win.locator('.tree-item.root-item');
    const menu = win.locator('.sidebar > .context-menu');

    await test.step('right-click the root: the folder actions are there', async () => {
      await rootRow.click({ button: 'right' });
      for (const name of ['New Note', 'New Folder', 'Copy Path', 'Label Version…', 'View Local History…']) {
        await expect(menu.getByRole('button', { name, exact: true })).toBeVisible();
      }
      await expect(menu.getByRole('button', { name: 'Open In' })).toBeVisible();
      await expect(menu.getByRole('button', { name: 'View Objects' })).toBeVisible();
      // Not offered: they'd act on every note at once, or on the thoughtbase itself.
      for (const name of ['Delete', 'Rename', 'Add Tag…', 'Format']) {
        await expect(menu.getByRole('button', { name, exact: true })).toHaveCount(0);
      }
    });

    await test.step('Copy Path copies where the thoughtbase is on disk', async () => {
      await menu.getByRole('button', { name: 'Copy Path', exact: true }).click();
      const copied = await app.evaluate(({ clipboard }) => clipboard.readText());
      expect(fs.realpathSync(copied)).toBe(fs.realpathSync(projectDir));
    });

    await test.step('View Objects lists the whole thoughtbase\'s types and opens an unscoped view', async () => {
      await rootRow.click({ button: 'right' });
      await menu.getByRole('button', { name: 'View Objects' }).focus();
      const types = win.getByRole('menu', { name: /^View objects in / });
      await expect(types.getByRole('menuitem', { name: /Place/ })).toContainText('2');
      await types.getByRole('menuitem', { name: /Place/ }).click();
      await expect(win.locator('.tab.active')).toHaveText(/Place/);
      await expect(win.locator('.tab.active')).not.toContainText('·'); // no folder scope
      await expect(win.locator('.tv-table tbody tr')).toHaveCount(2, { timeout: 10_000 });
    });

    await test.step('View Local History opens over every note', async () => {
      await rootRow.click({ button: 'right' });
      await menu.getByRole('button', { name: 'View Local History…', exact: true }).click();
      const title = win.locator('#multi-file-history-title');
      await expect(title).toHaveText(/^\d+ notes in selection$/, { timeout: 10_000 });
      const n = Number((await title.textContent())!.match(/^\d+/)![0]);
      expect(n).toBeGreaterThanOrEqual(3); // the fixture's notes plus the two seeded here
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
