/**
 * Link-hover previews on a published site (#2710, part 2). The app's link
 * hover (the Preview pane's shared `NoteHoverPreview`, #2713) is the reference.
 * The static site is exported through the real pipeline and opened from disk
 * (`file://`, the hardest case: no `fetch`) in a plain Chromium window:
 *
 * - hovering a prose link opens, after the 250ms delay, the SAME title and
 *   snippet the app shows for that note; it's a `role="tooltip"` the link names
 *   with `aria-describedby`, and it closes when the pointer leaves;
 * - a Kanban card in the published board shows the same preview on hover;
 * - Tab onto another link opens its preview at once, with focus staying on the
 *   link; Escape closes it;
 * - a link to a private note is plain text, and its text is nowhere in the site.
 */
import { test, expect, type Page } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { seedNotes } from './helpers/timeline';

const SECRET = 'the combination is 31-41-59';
const BOARD = { typeId: 'project', layout: 'kanban', groupBy: 'status' };
const NOTES = {
  'projects/Garden Shed.md': '---\ntype: project\nstatus: active\n---\n# Garden Shed\n\nA cedar shed at the bottom of the garden, built over two summers.\n',
  'Moon landing.md': '# Moon landing\n\nThe Eagle has landed at Tranquility Base.\n\nHouston, Tranquility Base here.\n',
  'Diary.md': `---\nprivate: true\n---\n# Diary\n\n${SECRET}\n`,
  'Links.md': ['# Links', '', 'See [[Garden Shed]] and [[Moon landing]], but not [[Diary]].', '', '```object-view', JSON.stringify(BOARD), '```', ''].join('\n'),
};
const TARGETS = ['Garden Shed', 'Moon landing'] as const;

interface Shown { title: string; snippet: string }

async function runExport(win: Page, args: Record<string, unknown>): Promise<string[]> {
  const res = await win.evaluate(async (a) => (window as unknown as {
    api: { publish: { runExport(a: unknown): Promise<{ writtenPaths: string[] } | null> } };
  }).api.publish.runExport(a), args);
  expect(res).not.toBeNull();
  return res!.writtenPaths;
}

/** The published preview's title and snippet, once shown. */
async function sitePreview(page: Page): Promise<Shown> {
  const tip = page.locator('#minerva-link-preview');
  await expect(tip).toBeVisible({ timeout: 5_000 });
  await expect(tip).toHaveAttribute('role', 'tooltip');
  return {
    title: (await tip.locator('.mlp-title').textContent()) ?? '',
    snippet: (await tip.locator('.mlp-snippet').textContent()) ?? '',
  };
}

test('a published page previews its links as the app does, on hover and on keyboard focus (#2710)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-site-previews-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-site-previews-project-'));
  const siteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-site-previews-site-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  seedNotes(projectDir, NOTES);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 950, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    const row = win.locator('[data-relative-path="Links.md"]').first();
    await expect(row).toBeVisible({ timeout: 25_000 });

    const expected = new Map<string, Shown>();
    await test.step('the app: the Preview pane\'s link hover, the reference', async () => {
      await row.click();
      await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:togglePreview'); });
      for (const t of TARGETS) {
        const link = win.locator(`.preview .wiki-link[data-target="${t}"]`);
        await expect(link).toBeVisible({ timeout: 15_000 });
        await link.hover();
        const tip = win.locator('.note-hover-preview');
        await expect(tip.locator('.nhp-snippet:not(.nhp-loading)')).toHaveCount(1, { timeout: 5_000 });
        expected.set(t, {
          title: (await tip.locator('.nhp-title-text').textContent()) ?? '',
          snippet: (await tip.locator('.nhp-snippet').textContent()) ?? '',
        });
        await win.mouse.move(2, 2);
        await expect(tip).toHaveCount(0, { timeout: 5_000 });
      }
      expect(expected.get('Garden Shed')!.snippet).toContain('cedar shed');
      expect(expected.get('Moon landing')!.snippet).toContain('Tranquility');
    });

    await test.step('export the static site', async () => {
      await runExport(win, { exporterId: 'static-site', input: { kind: 'project' }, outputDir: siteDir });
      expect(fs.existsSync(path.join(siteDir, 'previews.js'))).toBe(true);
      expect(fs.existsSync(path.join(siteDir, 'preview.js'))).toBe(true);
      for (const f of fs.readdirSync(siteDir, { recursive: true }) as string[]) {
        const abs = path.join(siteDir, f);
        if (fs.statSync(abs).isFile()) expect(fs.readFileSync(abs, 'utf-8'), f).not.toContain(SECRET);
      }
    });

    // The published page, opened from disk in a plain window (no preload, no app).
    const pagePromise = app.waitForEvent('window', { predicate: (p) => p.url().endsWith('/Links.html'), timeout: 20_000 });
    await app.evaluate(async ({ BrowserWindow }, file) => {
      const w = new BrowserWindow({ width: 1100, height: 900, show: true });
      await w.loadFile(file);
    }, path.join(siteDir, 'Links.html'));
    const page = await pagePromise;
    await page.waitForLoadState('load');
    const tip = page.locator('#minerva-link-preview');

    await test.step('hover a prose link: the app\'s preview, after the delay; leaving closes it', async () => {
      const link = page.locator('article p a', { hasText: 'Garden Shed' });
      await link.hover();
      await expect(tip).toBeHidden(); // not yet: 250ms
      expect(await sitePreview(page)).toEqual(expected.get('Garden Shed'));
      await expect(link).toHaveAttribute('aria-describedby', 'minerva-link-preview');
      await page.screenshot({ path: 'test-results/export-link-previews-hover.png' });
      await page.mouse.move(2, 400);
      await expect(tip).toBeHidden({ timeout: 5_000 });
      await expect(link).not.toHaveAttribute('aria-describedby', /.+/);
    });

    await test.step('hover a Kanban card in the published board: the same preview', async () => {
      const card = page.locator('.minerva-live-block a[href]', { hasText: 'Garden Shed' }).first();
      await expect(card).toBeVisible();
      await card.hover();
      expect(await sitePreview(page)).toEqual(expected.get('Garden Shed'));
      await page.mouse.move(2, 400);
      await expect(tip).toBeHidden({ timeout: 5_000 });
    });

    await test.step('Tab onto another link: its preview opens at once, focus stays; Escape closes', async () => {
      const first = page.locator('article p a', { hasText: 'Garden Shed' });
      const second = page.locator('article p a', { hasText: 'Moon landing' });
      await first.focus();
      await page.keyboard.press('Tab');
      await expect(second).toBeFocused();
      expect(await sitePreview(page)).toEqual(expected.get('Moon landing'));
      await expect(second).toHaveAttribute('aria-describedby', 'minerva-link-preview');
      await page.screenshot({ path: 'test-results/export-link-previews-focus.png' });
      await page.keyboard.press('Escape');
      await expect(tip).toBeHidden();
      await expect(second).toBeFocused();
    });

    await test.step('a link to a private note is plain text, with no preview', async () => {
      const diary = page.locator('article .wikilink-broken', { hasText: 'Diary' });
      await expect(diary).toBeVisible();
      await diary.hover();
      await page.waitForTimeout(500);
      await expect(tip).toBeHidden();
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir, siteDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
