/**
 * The parity test for plugin code (#2833, design `docs/plugin-code.md` →
 * *Order*): a view nobody's core code draws, built as a third-party plugin
 * on the published API alone. Link Map (`tests/fixtures/plugins/link-map/`,
 * plain JS) maps notes and their links from the query it declares.
 * Installed and allowed like any plugin, it draws the graph, opens a note
 * by click and by keyboard, works as a tab as well as a panel, and passes
 * the same accessibility scan as the app's own views.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { runAxe, seriousOrWorse, formatViolations } from '../helpers/axe-playwright';

const NOTES: Record<string, string> = {
  'map/Alpha.md': '# Alpha\n\nSee [[Beta]] and [[Gamma]].\n',
  'map/Beta.md': '# Beta\n\nOn to [[Gamma]].\n',
  'map/Gamma.md': '# Gamma\n',
  'map/Delta.md': '# Delta\n\nLinked to nothing.\n',
};

test('Link Map: a graph view built as a third-party plugin, on the API alone (#2833)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-link-map-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-link-map-project-'));
  const downloads = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-link-map-src-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'plugins', 'link-map'), path.join(downloads, 'link-map'), { recursive: true });
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  for (const [rel, content] of Object.entries(NOTES)) {
    fs.mkdirSync(path.dirname(path.join(projectDir, rel)), { recursive: true });
    fs.writeFileSync(path.join(projectDir, rel), content);
  }
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path]').first()).toBeVisible({ timeout: 15_000 });
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = (() => Promise.resolve({ canceled: false, filePaths: [folder] }));
      dialog.showMessageBox = (() => Promise.resolve({ response: 0, checkboxChecked: false }));
    }, path.join(downloads, 'link-map'));
    const tab = win.locator('.sidebar .panel-tab[title="Link Map"]');

    await test.step('installed and allowed like any plugin', async () => {
      const settings = win.getByRole('dialog', { name: 'Settings' });
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', 'app.settings'); });
      await expect(settings).toBeVisible({ timeout: 5000 });
      await settings.locator('nav.tabs button.tab', { has: win.locator('.tab-label', { hasText: /^Plugins$/ }) }).click();
      await settings.getByRole('button', { name: 'Install from folder…' }).click();
      await expect(settings.getByRole('checkbox', { name: 'Turn off Link Map' })).toBeChecked({ timeout: 10_000 });
      await settings.getByRole('button', { name: 'Cancel' }).click();
      await expect(tab).toBeVisible({ timeout: 10_000 });
    });

    const map = win.locator('.sidebar iframe[title="Link Map"]').contentFrame();
    await test.step('it maps the notes and their links, from its own query', async () => {
      await tab.click();
      for (const name of ['Alpha', 'Beta', 'Gamma', 'Delta']) {
        await expect(map.getByRole('button', { name: `Open ${name}`, exact: true })).toBeVisible({ timeout: 15_000 });
      }
      await expect(map.locator('#summary')).toHaveText(/^\d+ notes, \d+ links$/);
      expect(await map.locator('line.edge').count()).toBeGreaterThanOrEqual(3);
    });

    await test.step('a node opens its note, by click and by keyboard', async () => {
      await map.getByRole('button', { name: 'Open Beta', exact: true }).click();
      await expect(win.locator('.tab.active')).toContainText('Beta', { timeout: 10_000 });
      await map.getByRole('button', { name: 'Open Delta', exact: true }).focus();
      await win.keyboard.press('Enter');
      await expect(win.locator('.tab.active')).toContainText('Delta', { timeout: 10_000 });
    });

    await test.step('as the app\'s own views do: it opens in a tab too, and passes the accessibility scan', async () => {
      const inFrame = seriousOrWorse(await runAxe(win)).filter((v) => v.nodes.some((n) => String(n.target[0]).startsWith('minerva-plugin://link-map')));
      expect(inFrame, formatViolations(inFrame)).toEqual([]);
      await win.getByRole('button', { name: 'Open Link Map in a tab' }).click();
      await expect(win.locator('.tab.active')).toContainText('Link Map', { timeout: 10_000 });
      const inTab = win.locator('.plugin-view-tab iframe[title="Link Map"]').contentFrame();
      await expect(inTab.getByRole('button', { name: 'Open Gamma', exact: true })).toBeVisible({ timeout: 15_000 });
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, downloads]) fs.rmSync(d, { recursive: true, force: true });
  }
});
