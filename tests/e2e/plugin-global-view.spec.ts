/**
 * A plugin's global view as a sidebar panel (#2640), through the Reading
 * Queue, end to end: turned on in Settings → Plugins, its panel joins the
 * left rail; its page is framed and fed by the query it declares, which main
 * reads from the plugin's own folder and runs; a row opens its note; ✓ marks
 * a book read through the scoped write, and the re-run query takes it away.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const NOTES: Record<string, string> = {
  'reading/Meditations.md': '---\ntype: book\nstatus: reading\nauthor: Marcus Aurelius\n---\n# Meditations\n',
  'reading/Walden.md': '---\ntype: book\nstatus: to-read\n---\n# Walden\n',
  'reading/Finished.md': '---\ntype: book\nstatus: read\n---\n# Finished\n',
};

test('the Reading Queue: a panel fed by its own query, opening and marking notes (#2640)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-global-view-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-global-view-project-'));
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
    const tab = win.locator('.sidebar .panel-tab[title="Reading Queue"]');

    await test.step('off by default: no panel', async () => {
      await expect(win.locator('.sidebar .panel-tab[title="Notes"]')).toBeVisible();
      await expect(tab).toHaveCount(0);
    });

    await test.step('turned on in Settings → Plugins, its panel joins the rail', async () => {
      const settings = win.getByRole('dialog', { name: 'Settings' });
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', 'app.settings'); });
      await expect(settings).toBeVisible({ timeout: 5000 });
      await settings.locator('nav.tabs button.tab', { has: win.locator('.tab-label', { hasText: /^Plugins$/ }) }).click();
      await settings.getByRole('checkbox', { name: 'Turn on Reading Queue' }).click();
      await expect(settings.getByRole('checkbox', { name: 'Turn off Reading Queue' })).toBeChecked();
      await settings.getByRole('button', { name: 'Cancel' }).click();
      await expect(tab).toBeVisible({ timeout: 10_000 });
    });

    const queue = win.locator('.sidebar iframe[title="Reading Queue"]').contentFrame();
    await test.step('its page lists what its query names: reading first, the read book left out', async () => {
      await tab.click();
      await expect(queue.locator('li .title')).toHaveText(['Meditations', 'Walden'], { timeout: 15_000 });
      await expect(queue.getByRole('heading')).toHaveText(['Reading', 'Up next']);
      await expect(queue.getByText('Marcus Aurelius')).toBeVisible();
    });

    await test.step('a row opens its note', async () => {
      await queue.getByRole('button', { name: /Walden/ }).first().click();
      await expect(win.locator('.tab.active')).toContainText('Walden', { timeout: 10_000 });
    });

    await test.step('✓ marks it read, and the queue follows the graph', async () => {
      await queue.locator('li', { hasText: 'Meditations' }).hover();
      await queue.getByRole('button', { name: 'Mark Meditations read' }).click();
      await expect.poll(() => fs.readFileSync(path.join(projectDir, 'reading/Meditations.md'), 'utf8'), { timeout: 10_000 }).toContain('status: read');
      await expect(queue.locator('li .title')).toHaveText(['Walden'], { timeout: 15_000 });
    });
  } finally {
    await closeMinerva(app);
  }
});
