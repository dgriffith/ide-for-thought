/**
 * Real-browser modal focus-trap / tab-order test (#1104).
 *
 * The app's dialogs render as `<div role="dialog" aria-modal="true">` overlays,
 * which don't natively trap Tab focus — so `use:trapFocus` (src/renderer/lib/
 * trap-focus.ts) does it in JS. This drives the flagship keyboard-first modal,
 * the Command Palette, in real Chromium (where Tab actually moves focus) and
 * asserts focus never escapes to the app behind the overlay, and is restored to
 * the editor when the palette closes.
 *
 * Boots the in-tree `.vite/build` app (like the other e2e specs), so it needs
 * `pnpm build:e2e` first.
 */
import { test, expect, _electron as electron, type Page } from '@playwright/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';

const projectRoot = path.resolve(__dirname, '..', '..');

async function launch() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-focustrap-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-focustrap-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]),
  );
  const app = await electron.launch({
    args: [projectRoot, `--user-data-dir=${userDataDir}`],
    cwd: projectRoot,
    timeout: 60_000,
    env: { ...process.env, ELECTRON_ENABLE_LOGGING: '1' },
  });
  return { app, userDataDir, projectDir };
}

/** Is the renderer's focus currently inside the given selector's element? */
async function focusInside(win: Page, selector: string): Promise<boolean> {
  return win.evaluate((sel) => {
    const el = document.querySelector(sel);
    return !!el && el.contains(document.activeElement);
  }, selector);
}

test('command palette traps Tab focus and restores it to the editor on close', async () => {
  const { app, userDataDir, projectDir } = await launch();
  try {
    const win: Page = await app.firstWindow({ timeout: 20_000 });
    await win.waitForLoadState('domcontentloaded');
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });

    // Open a note and put focus in the editor, so we have a known place for the
    // palette to restore focus to on close.
    await win.locator('[data-relative-path$=".md"]').first().click();
    await expect(win.locator('.cm-content')).toBeVisible({ timeout: 10_000 });
    await win.locator('.cm-content').click();
    expect(await focusInside(win, '.cm-content'), 'editor should be focused before opening the palette').toBe(true);

    const palette = '.dialog[aria-label="Command palette"]';

    // Open the palette (⌘K). Its input autofocuses, so focus starts inside.
    await win.keyboard.press('Meta+KeyK');
    await expect(win.locator(palette)).toBeVisible({ timeout: 5000 });
    expect(await focusInside(win, palette), 'focus should start inside the palette').toBe(true);

    // Tab forward many times — focus must never escape to the app behind it.
    for (let i = 0; i < 20; i++) {
      await win.keyboard.press('Tab');
      expect(await focusInside(win, palette), `focus escaped after ${i + 1} Tab(s)`).toBe(true);
    }
    // …and Shift+Tab backward.
    for (let i = 0; i < 20; i++) {
      await win.keyboard.press('Shift+Tab');
      expect(await focusInside(win, palette), `focus escaped after ${i + 1} Shift+Tab(s)`).toBe(true);
    }

    // Escape closes the palette and focus returns to the editor (not stranded
    // on the now-removed dialog node).
    await win.keyboard.press('Escape');
    await expect(win.locator(palette)).toHaveCount(0, { timeout: 5000 });
    expect(await focusInside(win, '.cm-content'), 'focus should return to the editor after close').toBe(true);
  } finally {
    await app.close().catch(() => { /* already exited */ });
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
