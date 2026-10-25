/**
 * A third-party plugin with code, end to end (#2833), through the Note Stats
 * fixture (`tests/fixtures/plugins/note-stats/`, plain JS, no build): installed
 * from a folder in Settings → Plugins, Minerva asks natively before it goes in;
 * its panel joins the left rail, fed by the query it declares; its command
 * runs its worker's handler on the selection. Edited in place, it goes off
 * until allowed again from Settings, and comes back.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, isolatedHome, launchMinerva, projectRoot } from './helpers/launch';

const FIXTURE = path.join(projectRoot, 'tests', 'fixtures', 'plugins', 'note-stats');

test('a third-party plugin with code: allowed at install, its panel and command run, and an edit asks again (#2833)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-third-party-code-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-third-party-code-project-'));
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-third-party-code-src-'));
  fs.cpSync(FIXTURE, path.join(downloads, 'note-stats'), { recursive: true });
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'Five.md'), 'one two three four five\n');
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const installedDir = path.join(isolatedHome(userDataDir), '.minerva', 'plugins', 'note-stats');
  const app = await launchMinerva({ userDataDir });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path="Five.md"]').first()).toBeVisible({ timeout: 15_000 });
    const settings = win.getByRole('dialog', { name: 'Settings' });
    const openPlugins = async () => {
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', 'app.settings'); });
      await expect(settings).toBeVisible({ timeout: 5000 });
      await settings.locator('nav.tabs button.tab', { has: win.locator('.tab-label', { hasText: /^Plugins$/ }) }).click();
    };
    // Main's own dialogs, answered here: the folder picked, and Allow on whatever it asks.
    await app.evaluate(({ dialog }, folder) => {
      const g = globalThis as typeof globalThis & { __e2eAsked?: string[] };
      g.__e2eAsked = [];
      dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [folder] }));
      dialog.showMessageBox = ((_w: unknown, o?: Electron.MessageBoxOptions) => {
        g.__e2eAsked!.push((o ?? (_w as Electron.MessageBoxOptions)).message);
        return Promise.resolve({ response: 0, checkboxChecked: false });
      });
    }, path.join(downloads, 'note-stats'));
    const asked = () => app.evaluate(() => (globalThis as typeof globalThis & { __e2eAsked?: string[] }).__e2eAsked ?? []);
    const tab = win.locator('.sidebar .panel-tab[title="Note Lengths"]');

    await test.step('installed from a folder, Minerva asks natively before its code goes in', async () => {
      await openPlugins();
      await settings.getByRole('button', { name: 'Install from folder…' }).click();
      await expect.poll(asked, { timeout: 10_000 }).toEqual(['Install Note Stats? It runs code inside Minerva.']);
      await expect(settings.getByRole('checkbox', { name: 'Turn off Note Stats' })).toBeChecked({ timeout: 10_000 });
      await expect(settings.getByRole('list', { name: 'Installed plugins' }).getByText('It can read the notes Minerva hands its views and commands')).toBeVisible();
      await settings.getByRole('button', { name: 'Cancel' }).click();
    });

    await test.step('its panel joins the rail, fed by its own query, counting words', async () => {
      await expect(tab).toBeVisible({ timeout: 10_000 });
      await tab.click();
      const panel = win.locator('.sidebar iframe[title="Note Lengths"]').contentFrame();
      await expect(panel.locator('li', { hasText: 'Five' })).toContainText('5 words', { timeout: 15_000 });
    });

    await test.step('its command runs its worker\'s handler on the selection', async () => {
      await win.locator('.sidebar .panel-tab[title="Notes"]').click();
      await win.locator('[data-relative-path="Five.md"]').first().click();
      await expect(win.locator('.cm-content .cm-line').first()).toHaveText('one two three four five', { timeout: 10_000 });
      await win.locator('.cm-content').click();
      await win.keyboard.press('ControlOrMeta+KeyA');
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', 'view.commandPalette'); });
      const palette = win.locator('.dialog[aria-label="Command palette"]');
      await expect(palette).toBeVisible({ timeout: 5000 });
      await win.keyboard.type('Count Words');
      await expect(palette.locator('.result-item', { hasText: 'Count Words in Selection' })).toBeEnabled({ timeout: 5000 });
      await win.keyboard.press('Enter');
      await expect(win.getByText('5 words selected.').first()).toBeVisible({ timeout: 15_000 });
    });

    await test.step('edited in place, it goes off until allowed again, and comes back', async () => {
      fs.appendFileSync(path.join(installedDir, 'words.js'), '\n// edited after it was allowed\n');
      await expect(tab).toHaveCount(0, { timeout: 15_000 });
      await openPlugins();
      await expect(settings.getByText('Changed since you allowed it')).toBeVisible({ timeout: 10_000 });
      await settings.getByRole('button', { name: 'Review and allow Note Stats' }).click();
      await expect.poll(async () => (await asked()).at(-1), { timeout: 10_000 }).toBe('Note Stats changed since you allowed it. Allow it again?');
      await expect(settings.getByText('Changed since you allowed it')).toHaveCount(0, { timeout: 10_000 });
      await settings.getByRole('button', { name: 'Cancel' }).click();
      await expect(tab).toBeVisible({ timeout: 10_000 });
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, downloads]) fs.rmSync(d, { recursive: true, force: true });
  }
});
