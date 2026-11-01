/**
 * A built-in plugin's theme, through the Steel sample, end to end: off, it
 * isn't offered; turned on in Settings → Plugins, it joins the theme pickers
 * (Settings → Appearance and View → Theme), read from the theme file bundled
 * into the packaged app, and choosing it recolours the window.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

test('Steel: a built-in plugin theme is offered while the plugin is on, and applies', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-theme-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-theme-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path]').first()).toBeVisible({ timeout: 15_000 });
    const settings = win.getByRole('dialog', { name: 'Settings' });
    const openTab = async (label: string) => {
      if (!(await settings.isVisible())) {
        await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', 'app.settings'); });
        await expect(settings).toBeVisible({ timeout: 5000 });
      }
      await settings.locator('nav.tabs button.tab', { has: win.locator('.tab-label', { hasText: new RegExp(`^${label}$`) }) }).click();
    };
    const themeMenu = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items
      .find((i) => i.label === 'View')?.submenu?.items.find((i) => i.label === 'Theme')?.submenu?.items.map((i) => i.label) ?? []);
    const steel = settings.locator('#theme option[value="plugin:steel-theme/steel"]');

    await test.step('off, Steel is not offered', async () => {
      expect(await themeMenu()).not.toContain('Steel (Steel)');
      await openTab('Appearance');
      await expect(steel).toHaveCount(0);
    });

    await test.step('turned on, it joins the pickers', async () => {
      await openTab('Plugins');
      await settings.getByRole('checkbox', { name: 'Turn on Steel' }).click();
      await expect(settings.getByRole('checkbox', { name: 'Turn off Steel' })).toBeChecked();
      await expect.poll(themeMenu, { timeout: 10_000 }).toContain('Steel (Steel)');
      await openTab('Appearance');
      await expect(steel).toHaveCount(1, { timeout: 10_000 });
    });

    await test.step('chosen, it recolours the window', async () => {
      await settings.locator('#theme').selectOption('plugin:steel-theme/steel');
      await expect.poll(() => win.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--accent').trim()), { timeout: 5000 }).toBe('#36648b');
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
