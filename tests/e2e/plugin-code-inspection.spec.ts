/**
 * A plugin's inspection written as code, end to end (#2831), through Outline
 * Checks: turned on in Settings → Plugins, its check runs in its worker host
 * with the sweep, reads the notes its query found, and the note whose
 * headings skip a level shows in the Inspections panel; Settings lists the
 * check as the plugin's.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

test('Outline Checks: an inspection run by a plugin\'s handler finds a skipped heading (#2831)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-code-inspection-userdata-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-code-inspection-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Lopsided.md'), '# Lopsided\n\n### Too deep\n\nText.\n');
  fs.writeFileSync(path.join(dir, 'Tidy.md'), '# Tidy\n\n## Fine\n');
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: dir }]));
  const app = await launchMinerva({ userDataDir });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path="Lopsided.md"]').first()).toBeVisible({ timeout: 15_000 });
    const settings = win.getByRole('dialog', { name: 'Settings' });
    const openSettings = async (tab: string) => {
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'app.settings'); });
      await expect(settings).toBeVisible({ timeout: 5000 });
      await settings.locator('nav.tabs button.tab', { has: win.locator('.tab-label', { hasText: new RegExp(`^${tab}$`) }) }).click();
    };

    await test.step('turned on in Settings → Plugins, its check is listed as the plugin\'s', async () => {
      await openSettings('Plugins');
      await settings.getByRole('checkbox', { name: 'Turn on Outline Checks' }).click();
      await expect(settings.getByRole('checkbox', { name: 'Turn off Outline Checks' })).toBeChecked();
      await settings.getByRole('button', { name: 'Cancel' }).click();
      await openSettings('Inspections');
      await expect(settings.getByRole('checkbox', { name: 'Skipped heading levels' })).toBeChecked({ timeout: 10_000 });
      await expect(settings.getByText('Headings that jump a level, like an H1 straight to an H3, leaving a gap in the outline. From Outline Checks.')).toBeVisible();
      await settings.getByRole('button', { name: /^(Done|Cancel)$/ }).first().click();
      await expect(settings).toHaveCount(0);
    });

    await test.step('the sweep runs it, and the skipped heading is a finding', async () => {
      const panel = win.locator('.inspections-panel');
      const finding = panel.locator('.inspection-item', { hasText: '"Too deep" goes from H1 to H3, skipping a level.' });
      await win.locator('[data-relative-path="Lopsided.md"]').first().click();
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'view.toggleRightSidebar'); });
      await win.locator('.right-sidebar .group-tab', { hasText: 'Activity' }).click();
      await win.locator('.right-sidebar .sub-tab', { hasText: 'Inspections' }).click();
      await expect.poll(async () => {
        if (await finding.count() > 0) return true;
        await panel.locator('.refresh-btn').click();
        return false;
      }, { timeout: 30_000, intervals: [1000] }).toBe(true);
      await expect(finding).toHaveAttribute('title', 'Make "Too deep" an H2, or add the heading it belongs under.');
      await expect(panel.locator('.inspection-item', { hasText: 'Tidy' })).toHaveCount(0);
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, dir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
