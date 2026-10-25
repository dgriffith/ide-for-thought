/**
 * A plugin's ingestor (#2647), through Transcripts, end to end: turned on in
 * Settings → Plugins, its file types join the Ingest File dialog, and a
 * `.vtt` picked there is parsed by its handler in the plugin's worker host
 * and written by Minerva as a Source, the body escaped and the plugin named
 * in meta.ttl.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const VTT = [
  'WEBVTT', '',
  '00:00.000 --> 00:02.000', '<v Ada>Engines can compose &lt;music&gt;.', '',
  '00:10.000 --> 00:12.000', '<v Ada>After a pause.', '',
].join('\n');

test('Transcripts: a plugin ingestor reads a caption file into a Source (#2647)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-ingestor-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-ingestor-project-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-plugin-ingestor-file-'));
  const fixture = path.join(outsideDir, 'keynote.en.vtt');
  fs.writeFileSync(fixture, VTT);
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 860, rootPath: projectDir }]));
  const sourcesDir = path.join(projectDir, '.minerva', 'sources');
  const before = new Set(fs.existsSync(sourcesDir) ? fs.readdirSync(sourcesDir) : []);
  const app = await launchMinerva({ userDataDir });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    await expect(win.locator('[data-relative-path]').first()).toBeVisible({ timeout: 15_000 });

    await test.step('turned on in Settings → Plugins', async () => {
      const settings = win.getByRole('dialog', { name: 'Settings' });
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]?.webContents.send('menu:command', 'app.settings'); });
      await expect(settings).toBeVisible({ timeout: 5000 });
      await settings.locator('nav.tabs button.tab', { has: win.locator('.tab-label', { hasText: /^Plugins$/ }) }).click();
      await settings.getByRole('checkbox', { name: 'Turn on Transcripts' }).click();
      await expect(settings.getByRole('checkbox', { name: 'Turn off Transcripts' })).toBeChecked();
      await settings.getByRole('button', { name: 'Cancel' }).click();
    });

    await test.step('Ingest File offers .srt and .vtt, and reads the picked file through the plugin', async () => {
      await app.evaluate(({ dialog }, file) => {
        const g = globalThis as typeof globalThis & { __e2eFilters?: string[] };
        dialog.showOpenDialog = ((_win: unknown, opts: Electron.OpenDialogOptions) => {
          g.__e2eFilters = (opts.filters ?? []).flatMap((f) => f.extensions);
          return Promise.resolve({ canceled: false, filePaths: [file] });
        }) as typeof dialog.showOpenDialog;
      }, fixture);
      await app.evaluate(({ BrowserWindow }) => {
        BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'research.ingestFile');
      });

      let dir = '';
      await expect.poll(() => {
        const added = fs.existsSync(sourcesDir) ? fs.readdirSync(sourcesDir).filter((d) => !before.has(d)) : [];
        dir = added.map((d) => path.join(sourcesDir, d)).find((d) => fs.existsSync(path.join(d, 'meta.ttl'))) ?? '';
        return dir !== '';
      }, { timeout: 20_000, message: 'the transcript never became a Source' }).toBe(true);

      const filters = await app.evaluate(() => (globalThis as typeof globalThis & { __e2eFilters?: string[] }).__e2eFilters ?? []);
      expect(filters).toEqual(expect.arrayContaining(['pdf', 'srt', 'vtt']));
      expect(fs.readFileSync(path.join(dir, 'body.md'), 'utf-8'))
        .toBe('**[0:00]** *Ada:* Engines can compose \\<music>.\n\n**[0:10]** After a pause.\n');
      const meta = fs.readFileSync(path.join(dir, 'meta.ttl'), 'utf-8');
      expect(meta).toContain('dc:title "keynote" ;');
      expect(meta).toContain('dc:language "en" ;');
      expect(meta).toMatch(/minerva:ingestedBy "plugin:transcripts@\d+\.\d+\.\d+" ;/);
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, outsideDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
