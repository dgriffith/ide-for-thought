/**
 * A plugin's command (#2643), through List Tools, end to end in the packaged
 * app: turned on in Settings → Plugins, "Sort List in Selection" joins the
 * command palette — greyed out with nothing selected — and the editor's
 * right-click menu. Run on a selection, its handler sorts the list in the
 * plugin's worker host and the editor makes the change, which ⌘Z undoes in
 * one step; its own key, ⌘⌥⇧S, runs it too (#2879).
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const LIST = '# Groceries\n\n- milk\n- Eggs\n  - free range\n- bread\n';
const SORTED = ['# Groceries', '', '- bread', '- Eggs', '  - free range', '- milk', ''];
const ORIGINAL = ['# Groceries', '', '- milk', '- Eggs', '  - free range', '- bread', ''];

test('List Tools: a plugin command in the palette and the editor menu, run by its handler (#2643)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-command-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-command-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'groceries.md'), LIST);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 860, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const lines = win.locator('.cm-content .cm-line');
    const palette = win.locator('.dialog[aria-label="Command palette"]');
    // As View → Command Palette does: ⌘K in the editor, with text selected, makes a link.
    const openPalette = () => app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', 'view.commandPalette'); });
    const row = palette.locator('.result-item', { has: win.locator('.result-title', { hasText: 'Sort List in Selection' }) });

    await test.step('turned on in Settings → Plugins', async () => {
      await expect(win.locator('[data-relative-path="groceries.md"]').first()).toBeVisible({ timeout: 15_000 });
      const settings = win.getByRole('dialog', { name: 'Settings' });
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', 'app.settings'); });
      await expect(settings).toBeVisible({ timeout: 5000 });
      await settings.locator('nav.tabs button.tab', { has: win.locator('.tab-label', { hasText: /^Plugins$/ }) }).click();
      await settings.getByRole('checkbox', { name: 'Turn on List Tools' }).click();
      await expect(settings.getByRole('checkbox', { name: 'Turn off List Tools' })).toBeChecked();
      await settings.getByRole('button', { name: 'Cancel' }).click();
    });

    await test.step('in the palette, greyed out with nothing selected', async () => {
      await win.locator('[data-relative-path="groceries.md"]').first().click();
      await expect(lines).toHaveText(ORIGINAL, { timeout: 10_000 });
      await win.locator('.cm-content').click();
      await win.keyboard.press('ControlOrMeta+End');
      await openPalette();
      await expect(palette).toBeVisible({ timeout: 5000 });
      await win.keyboard.type('Sort List');
      await expect(row).toBeVisible({ timeout: 5000 });
      await expect(row.locator('.result-category')).toHaveText('Plugins › List Tools');
      await expect(row).toBeDisabled();
      await win.keyboard.press('Escape');
    });

    await test.step('run on a selection from the palette: sorted by its handler, nested items kept with their parent', async () => {
      await win.locator('.cm-content').click();
      await win.keyboard.press('ControlOrMeta+KeyA');
      await openPalette();
      await win.keyboard.type('Sort List');
      await expect(row).toBeEnabled({ timeout: 5000 });
      await win.keyboard.press('Enter');
      await expect(lines).toHaveText(SORTED, { timeout: 15_000 });
    });

    await test.step('⌘Z undoes it in one step', async () => {
      await win.locator('.cm-content').click();
      await win.keyboard.press('ControlOrMeta+KeyZ');
      await expect(lines).toHaveText(ORIGINAL);
    });

    await test.step('on its own key, ⌘⌥⇧S (#2879)', async () => {
      await win.locator('.cm-content').click();
      await win.keyboard.press('ControlOrMeta+KeyA');
      await win.keyboard.press('ControlOrMeta+Alt+Shift+KeyS');
      await expect(lines).toHaveText(SORTED, { timeout: 15_000 });
      await win.keyboard.press('ControlOrMeta+KeyZ');
      await expect(lines).toHaveText(ORIGINAL);
    });

    await test.step('and from the editor\'s right-click menu, under Plugins', async () => {
      await win.locator('.cm-content').click();
      await win.keyboard.press('ControlOrMeta+KeyA');
      await lines.nth(2).click({ button: 'right' });
      const menu = win.locator('.context-menu');
      await menu.locator('.submenu-trigger', { hasText: 'Plugins' }).hover();
      await menu.getByRole('button', { name: 'Sort List in Selection' }).click();
      await expect(lines).toHaveText(SORTED, { timeout: 15_000 });
      await expect.poll(() => fs.readFileSync(path.join(projectDir, 'groceries.md'), 'utf8'), { timeout: 10_000 })
        .toBe(SORTED.join('\n'));
    });
  } finally {
    await closeMinerva(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
