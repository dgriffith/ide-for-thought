/**
 * A plugin's SHACL inspection, end to end (#2642): the Reading List example
 * plugin, installed by hand, ships `inspections/finished-books.ttl`. Its
 * shape finds the finished Book Note with no finished date, the finding shows
 * in the Inspections panel in the shape's own words, Settings → Inspections
 * lists the check as the plugin's, and switching it off takes the finding away.
 * In the packaged app, so the bundled SHACL engine is the one that runs.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, isolatedHome, launchMinerva, projectRoot } from './helpers/launch';

test("a plugin's SHACL shape finds what it says, and its switch turns it off (#2642)", async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-shacl-userdata-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-shacl-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'Dune.md'), '---\ntitle: Dune\ntype: book-note\nstatus: finished\n---\n# Dune\n');
  fs.writeFileSync(path.join(dir, 'Middlemarch.md'), '---\ntitle: Middlemarch\ntype: book-note\nstatus: finished\nfinished: 2026-05-01\n---\n# Middlemarch\n');
  const plugins = path.join(isolatedHome(userDataDir), '.minerva', 'plugins');
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'plugins', 'reading-list'), path.join(plugins, 'reading-list'), { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1400, height: 900, rootPath: dir }]));
  const app = await launchMinerva({ userDataDir });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const panel = win.locator('.inspections-panel');
    const finding = panel.locator('.inspection-item', { hasText: '"Dune" is finished but has no finished date' });

    await test.step('the finished book with no date is a finding, in the shape\'s words', async () => {
      await win.locator('[data-relative-path="Dune.md"]').first().click();
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'view.toggleRightSidebar'); });
      await win.locator('.right-sidebar .group-tab', { hasText: 'Activity' }).click();
      await win.locator('.right-sidebar .sub-tab', { hasText: 'Inspections' }).click();
      await expect.poll(async () => {
        if (await finding.count() > 0) return true;
        await panel.locator('.refresh-btn').click();
        return false;
      }, { timeout: 20_000, intervals: [1000] }).toBe(true);
      await expect(finding).toHaveAttribute('title', 'Set its finished property to the day you finished it');
      await expect(panel.locator('.inspection-item', { hasText: 'Middlemarch' })).toHaveCount(0);
    });

    const settings = win.getByRole('dialog', { name: 'Settings' });
    const box = settings.getByRole('checkbox', { name: 'Finished books without a date' });
    await test.step('Settings lists it as the plugin\'s, and switching it off takes the finding away', async () => {
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'app.settings'); });
      await expect(settings).toBeVisible({ timeout: 5000 });
      await settings.locator('nav.tabs button.tab', { has: win.locator('.tab-label', { hasText: /^Inspections$/ }) }).click();
      await expect(box).toBeChecked({ timeout: 10_000 });
      await expect(settings.getByText("Book notes marked finished that don't say when. From Reading List.")).toBeVisible();
      await box.click();
      await expect(box).not.toBeChecked();
      await settings.getByRole('button', { name: /^(Done|Cancel)$/ }).first().click();
      await expect(settings).toHaveCount(0);
      await expect.poll(async () => {
        await panel.locator('.refresh-btn').click();
        await win.waitForTimeout(500);
        return finding.count();
      }, { timeout: 20_000, intervals: [1000] }).toBe(0);
    });
  } finally {
    await closeMinerva(app);
  }
});
