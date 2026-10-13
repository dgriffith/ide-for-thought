/**
 * Skills in the command palette (#2766): typing a stock skill's name in ⌘K
 * finds it under its menu, and one that needs a selection is greyed out until
 * there is one — the same gate as its menu item. Doesn't run a skill: that
 * would need a model, and what a run does is the menu's code path either way.
 */
import { test, expect } from './helpers/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

test('skills are in the command palette, gated like their menu items', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-palette-skills-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-palette-skills-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await win.locator('[data-relative-path$=".md"]').first().click();
    await expect(win.locator('.cm-content')).toBeVisible({ timeout: 10_000 });
    await win.locator('.cm-content').click();

    const palette = win.locator('.dialog[aria-label="Command palette"]');
    const row = (title: string) => palette.locator('.result-item', { has: win.locator('.result-title', { hasText: title }) });

    await test.step('typing a skill\'s name finds it, under its menu', async () => {
      await win.keyboard.press('ControlOrMeta+KeyK');
      await expect(palette).toBeVisible({ timeout: 5000 });
      await win.keyboard.type('Steelman');
      await expect(row('Steelman').first()).toBeVisible();
      await expect(row('Steelman').first().locator('.result-category')).toHaveText(/^Analysis( › |$)/); // a group shows as "Analysis › …"
      await expect(row('Steelman').first()).toBeEnabled();
    });

    await test.step('a selection skill is greyed out with nothing selected', async () => {
      await win.locator('.dialog[aria-label="Command palette"] input').fill('Deep Dive on Term');
      await expect(row('Deep Dive on Term').first()).toBeDisabled();
      await win.keyboard.press('Escape');
      await expect(palette).toHaveCount(0);
    });
  } finally {
    await closeMinerva(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
