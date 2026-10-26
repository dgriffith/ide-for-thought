/**
 * Local MCP servers, a built-in plugin off on a new install (#2891): Settings
 * → MCP Servers offers remote servers only and says why; turning the plugin
 * on in Settings → Plugins asks natively (it runs programs), and then a
 * local server can be added.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

test('Local MCP servers: off, only remote servers are offered; on (asked natively), local ones are (#2891)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-local-mcp-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-local-mcp-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: projectDir }]));
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
    await app.evaluate(({ dialog }) => {
      const g = globalThis as typeof globalThis & { __e2eAsked?: string[] };
      g.__e2eAsked = [];
      dialog.showMessageBox = ((_w: unknown, o?: Electron.MessageBoxOptions) => {
        g.__e2eAsked!.push((o ?? (_w as Electron.MessageBoxOptions)).message);
        return Promise.resolve({ response: 0, checkboxChecked: false });
      });
    });
    const asked = () => app.evaluate(() => (globalThis as typeof globalThis & { __e2eAsked?: string[] }).__e2eAsked ?? []);

    await test.step('off: remote servers only, and the tab says why', async () => {
      await openTab('MCP Servers');
      await expect(settings.getByTestId('mcp-local-off-note')).toBeVisible({ timeout: 5000 });
      await settings.getByRole('button', { name: 'Add server…' }).click();
      await expect(settings.getByLabel('Local command (stdio)')).toHaveCount(0);
      await expect(settings.getByLabel('Remote URL')).toBeChecked();
    });

    await test.step('turned on in Settings → Plugins, asked natively first', async () => {
      await openTab('Plugins');
      await settings.getByRole('checkbox', { name: 'Turn on Local MCP servers' }).check();
      await expect.poll(asked, { timeout: 10_000 }).toEqual([expect.stringContaining('Local MCP servers')]);
      await expect(settings.getByRole('checkbox', { name: 'Turn off Local MCP servers' })).toBeChecked({ timeout: 10_000 });
    });

    await test.step('on: a local server can be added', async () => {
      await openTab('MCP Servers');
      await expect(settings.getByTestId('mcp-local-off-note')).toHaveCount(0, { timeout: 5000 });
      await settings.getByRole('button', { name: 'Add server…' }).click();
      await expect(settings.getByLabel('Local command (stdio)')).toBeChecked();
    });
  } finally {
    await closeMinerva(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
