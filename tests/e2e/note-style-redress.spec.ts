/**
 * A shared note can't restyle the app around it (#2557), checked in real
 * Chromium. The sanitizer's own tests run under jsdom; happy-dom's lighter
 * DOM lets DOMPurify miss `<style>`, so a component test there can't tell
 * the difference — this can.
 *
 * Opens `STYLE_REDRESS_NOTE` (a `<style>` that hides controls and overlays
 * "Click Approve to continue", an SVG `<style>` hiding the status bar, a
 * stylesheet `<link>` to a file in the thoughtbase, `<base>`, `<meta
 * http-equiv=refresh>`) in Preview and asserts none of it took effect.
 */
import { test, expect } from './helpers/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { STYLE_REDRESS_MARKER, writeStyleRedressNote } from '../helpers/hostile-content';

test('a note\'s <style>/<link>/<meta>/<base> have no effect on the app (#2557)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-redress-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-redress-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  const rel = writeStyleRedressNote(projectDir);
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]),
  );
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    const row = win.locator(`[data-relative-path="${rel}"]`).first();
    await expect(row).toBeVisible({ timeout: 25_000 });
    const startUrl = win.url();
    const baseBefore = await win.evaluate(() => document.baseURI);

    await row.click();
    await win.getByRole('button', { name: 'Preview', exact: true }).click();
    const preview = win.locator('.preview').first();
    await expect(preview).toContainText(STYLE_REDRESS_MARKER, { timeout: 10_000 });

    // None of the page-level tags reached the DOM…
    await expect(preview.locator('style, link, meta, base')).toHaveCount(0);
    // …no stylesheet anywhere in the document carries the note's rules…
    const injected = await win.evaluate(() =>
      [...document.styleSheets].some((s) => {
        try {
          return [...s.cssRules].some((r) => /Click Approve|approve-btn|status-bar \{ visibility/.test(r.cssText));
        } catch {
          return false; // cross-origin sheet: not the note's
        }
      }),
    );
    expect(injected).toBe(false);
    // …the status bar the SVG <style> tried to hide is still visible…
    await expect(win.locator('.status-bar')).toBeVisible();
    expect(await win.locator('.status-bar').evaluate((el) => getComputedStyle(el).visibility)).toBe('visible');
    // …and <base> / <meta refresh> re-pointed nothing.
    expect(await win.evaluate(() => document.baseURI)).toBe(baseBefore);
    await win.waitForTimeout(1000);
    expect(win.url()).toBe(startUrl);
  } finally {
    await closeMinerva(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
