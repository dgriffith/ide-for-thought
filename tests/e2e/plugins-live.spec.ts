/**
 * Plugins apply without a restart (#2634): a plugin in ~/.minerva/plugins/
 * puts its skill in the command palette; turning it off in Settings → Plugins
 * takes the skill away and on again brings it back; and deleting the plugin's
 * folder outside the app takes it away too, through the folder watcher.
 */
import { test, expect } from './helpers/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { closeMinerva, isolatedHome, launchMinerva, projectRoot } from './helpers/launch';

test('a plugin\'s skill comes and goes with the plugin, live', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-plugins-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-plugins-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  const plugins = path.join(isolatedHome(userDataDir), '.minerva', 'plugins');
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'plugins', 'reading-list'), path.join(plugins, 'reading-list'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await win.locator('[data-relative-path$=".md"]').first().click();
    await expect(win.locator('.cm-content')).toBeVisible({ timeout: 10_000 });

    const palette = win.locator('.dialog[aria-label="Command palette"]');
    /** Does ⌘K find the plugin's skill right now? */
    const paletteFinds = async (): Promise<boolean> => {
      await win.locator('.cm-content').click();
      await win.keyboard.press('ControlOrMeta+KeyK');
      await expect(palette).toBeVisible({ timeout: 5000 });
      await palette.locator('input').fill('Reading Summary');
      const found = await palette.locator('.result-title', { hasText: 'Reading Summary' }).count() > 0;
      await win.keyboard.press('Escape');
      await expect(palette).toHaveCount(0);
      return found;
    };
    const settings = win.getByRole('dialog', { name: 'Settings' });
    const openPlugins = async () => {
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', 'app.settings'); });
      await expect(settings).toBeVisible({ timeout: 5000 });
      await settings.locator('nav.tabs button.tab', { has: win.locator('.tab-label', { hasText: /^Plugins$/ }) }).click();
      await expect(settings.getByText('Reading List', { exact: true })).toBeVisible();
    };
    // Plugin changes apply at once, not on Done — Cancel just closes.
    const closeSettings = async () => {
      await settings.getByRole('button', { name: 'Cancel' }).click();
      await expect(settings).toHaveCount(0);
    };

    await test.step('the installed plugin\'s skill is in the palette', async () => {
      await expect.poll(paletteFinds, { timeout: 10_000 }).toBe(true);
    });

    await test.step('turned off in Settings → Plugins, its skill goes — no restart', async () => {
      await openPlugins();
      await settings.getByRole('checkbox', { name: 'Turn off Reading List' }).click();
      await expect(settings.getByRole('checkbox', { name: 'Turn on Reading List' })).not.toBeChecked();
      await closeSettings();
      await expect.poll(paletteFinds, { timeout: 10_000 }).toBe(false);
      const records = JSON.parse(fs.readFileSync(path.join(path.dirname(plugins), 'plugins.json'), 'utf-8'));
      expect(records.plugins['reading-list'].enabled).toBe(false);
    });

    await test.step('turned back on, it\'s back', async () => {
      await openPlugins();
      await settings.getByRole('checkbox', { name: 'Turn on Reading List' }).click();
      await expect(settings.getByRole('checkbox', { name: 'Turn off Reading List' })).toBeChecked();
      await closeSettings();
      await expect.poll(paletteFinds, { timeout: 10_000 }).toBe(true);
    });

    await test.step('deleting the plugin\'s folder outside the app takes it away too', async () => {
      fs.rmSync(path.join(plugins, 'reading-list'), { recursive: true, force: true });
      await expect.poll(paletteFinds, { timeout: 15_000 }).toBe(false);
    });
  } finally {
    await closeMinerva(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
