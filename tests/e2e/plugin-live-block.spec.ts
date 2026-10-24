/**
 * A plugin's live block in the preview (#2641), through the Reading Queue's
 * ```reading-queue fence: drawn in the note by the plugin's own frame, fed
 * the query it declares, sized to its list, its rows opening their notes; its
 * one write (✓ marks a book read) is to a note its query gave it, and the
 * block follows the graph; and editing the note around it keeps the frame.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, isolatedHome, launchMinerva, projectRoot } from './helpers/launch';

test('a plugin block in a note: drawn, sized, opening, writing, and kept across edits (#2641)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-live-block-userdata-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-live-block-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), dir, { recursive: true });
  const write = (rel: string, c: string) => { fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true }); fs.writeFileSync(path.join(dir, rel), c); };
  write('reading/Meditations.md', '---\ntype: book\nstatus: reading\n---\n# Meditations\n');
  write('reading/Walden.md', '---\ntype: book\nstatus: to-read\n---\n# Walden\n');
  write('Plans.md', ['# Plans', '', 'What I am reading:', '', '```reading-queue', '```', '', 'Below the queue.', ''].join('\n'));
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1300, height: 1000, rootPath: dir }]));
  const minervaHome = path.join(isolatedHome(userDataDir), '.minerva');
  fs.mkdirSync(minervaHome, { recursive: true });
  fs.writeFileSync(path.join(minervaHome, 'plugins.json'), JSON.stringify({ plugins: { 'reading-queue': { enabled: true, source: { kind: 'core' } } } }));
  const app = await launchMinerva({ userDataDir });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    const block = win.locator('.preview .plugin-block [data-plugin-block="reading-queue"]');
    const queue = block.locator('iframe[title="Reading queue"]').contentFrame();
    // How far the block's height is from its list's: sized to fit is within a pixel or two.
    const misfit = async () => Math.abs(((await block.boundingBox())?.height ?? 0) - await queue.locator('.queue').evaluate((el) => el.scrollHeight));

    await test.step('the note, editor and preview side by side: the block drawn from its query', async () => {
      await win.locator('[data-relative-path="Plans.md"]').first().click();
      await expect.poll(async () => {
        if (await win.locator('.cm-content').isVisible() && await win.locator('.preview .plugin-block').count() > 0) return true;
        await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows()[0]!.webContents.send('menu:command', 'view.togglePreview'); });
        return false;
      }, { timeout: 10_000, intervals: [500] }).toBe(true);
      await expect(queue.locator('li .title')).toHaveText(['Meditations', 'Walden'], { timeout: 15_000 });
    });

    // Not "not the 120px default": the list's own height depends on the fonts
    // the frame falls back to, and on a CI runner it can be 120 (#2641). The
    // ✓ step below checks the block follows the list as it shrinks.
    await test.step('sized to its list', async () => {
      await expect.poll(misfit, { timeout: 10_000 }).toBeLessThanOrEqual(2);
    });

    await test.step('typing around it keeps the same frame, still drawn', async () => {
      await queue.locator('body').evaluate(() => { (window as unknown as { __mark?: number }).__mark = 7; });
      await win.locator('.cm-content').click();
      await win.keyboard.press('ControlOrMeta+End');
      for (const ch of ' ok') { await win.keyboard.type(ch); await win.waitForTimeout(250); }
      await expect(win.locator('.preview')).toContainText('Below the queue. ok');
      await expect(queue.locator('li .title')).toHaveText(['Meditations', 'Walden']);
      expect(await queue.locator('body').evaluate(() => (window as unknown as { __mark?: number }).__mark ?? null)).toBe(7);
    });

    await test.step('✓ marks a book read, and the block follows the graph — and shrinks to the shorter list', async () => {
      const before = (await block.boundingBox())!.height;
      await queue.locator('li', { hasText: 'Walden' }).hover();
      await queue.getByRole('button', { name: 'Mark Walden read' }).click();
      await expect.poll(() => fs.readFileSync(path.join(dir, 'reading/Walden.md'), 'utf8'), { timeout: 10_000 }).toContain('status: read');
      await expect(queue.locator('li .title')).toHaveText(['Meditations'], { timeout: 15_000 });
      await expect.poll(async () => (await block.boundingBox())?.height ?? before, { timeout: 10_000 }).toBeLessThan(before);
      await expect.poll(misfit, { timeout: 10_000 }).toBeLessThanOrEqual(2);
    });

    await test.step('a row opens its note', async () => {
      await queue.getByRole('button', { name: /Meditations/ }).first().click();
      await expect(win.locator('.tab.active')).toContainText('Meditations', { timeout: 10_000 });
    });
  } finally {
    await closeMinerva(app);
  }
});
