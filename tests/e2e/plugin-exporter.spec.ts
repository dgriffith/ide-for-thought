/**
 * A plugin's exporter (#2648), through EPUB, end to end: turned on in
 * Settings → Plugins, "EPUB…" joins the Export menu as a family of its own,
 * and exporting a note from its dialog runs the writer in the plugin's worker
 * host and leaves a book in the folder picked — mimetype first, a chapter
 * with the note's rendered text.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

test('EPUB: a plugin exporter in the Export menu writes a book where the user chose (#2648)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-exporter-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-exporter-project-'));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-exporter-out-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(path.join(projectDir, 'voyage.md'), '# The Voyage\n\nWe sailed at *dawn*, R&D crew aboard.\n');
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 900, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path="voyage.md"]').first()).toBeVisible({ timeout: 15_000 });
    const exportItems = () => app.evaluate(({ Menu }) => Menu.getApplicationMenu()?.items
      .find((i) => i.label === 'Export')?.submenu?.items.map((i) => i.label) ?? []);

    await test.step('turned on in Settings → Plugins, it joins the Export menu', async () => {
      expect(await exportItems()).not.toContain('EPUB…');
      const settings = win.getByRole('dialog', { name: 'Settings' });
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', 'app.settings'); });
      await expect(settings).toBeVisible({ timeout: 5000 });
      await settings.locator('nav.tabs button.tab', { has: win.locator('.tab-label', { hasText: /^Plugins$/ }) }).click();
      await settings.getByRole('checkbox', { name: 'Turn on EPUB' }).click();
      await expect(settings.getByRole('checkbox', { name: 'Turn off EPUB' })).toBeChecked();
      await settings.getByRole('button', { name: 'Cancel' }).click();
      await expect.poll(exportItems, { timeout: 10_000 }).toContain('EPUB…');
    });

    await test.step('Export as EPUB from the menu: the writer runs, Minerva writes the book', async () => {
      await win.locator('[data-relative-path="voyage.md"]').first().click();
      await app.evaluate(({ dialog }, dir) => {
        dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [dir] });
      }, outDir);
      await app.evaluate(({ Menu }) => {
        Menu.getApplicationMenu()?.items.find((i) => i.label === 'Export')?.submenu?.items.find((i) => i.label === 'EPUB…')?.click();
      });
      const dialog = win.getByRole('dialog', { name: 'Export as EPUB' });
      await expect(dialog).toBeVisible({ timeout: 10_000 });
      await dialog.locator('input[name="scope"][value="single-note"]').check();
      // The button is enabled by the project's plan too: wait for the note's.
      await expect(dialog.locator('.audit-section h3', { hasText: 'Including' }).locator('.count').first()).toHaveText('1', { timeout: 10_000 });
      await expect(dialog.getByRole('button', { name: 'Export…' })).toBeEnabled({ timeout: 10_000 });
      await dialog.getByRole('button', { name: 'Export…' }).click();
      await expect.poll(() => fs.readdirSync(outDir), { timeout: 20_000 }).toEqual(['The Voyage.epub']);
    });

    const zip = await JSZip.loadAsync(fs.readFileSync(path.join(outDir, 'The Voyage.epub')));
    expect(Object.keys(zip.files)[0]).toBe('mimetype');
    expect(await zip.file('mimetype')!.async('string')).toBe('application/epub+zip');
    const chapter = await zip.file('OEBPS/chapter-001.xhtml')!.async('string');
    expect(chapter).toMatch(/<h1[^>]*>The Voyage<\/h1>/);
    expect(chapter).toContain('We sailed at <em>dawn</em>, R&amp;D crew aboard.');
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
