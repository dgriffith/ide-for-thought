/**
 * The window never leaves the renderer (#2552, #2554), driven with TRUSTED
 * input — the only kind that triggers Chromium's default navigation, so the
 * only kind that can show these guards hold. A synthetic `dispatchEvent`
 * drop or click has no default action to cancel.
 *
 *  - A real file drop (CDP `Input.dispatchDragEvent`) of an `.html` on the
 *    sidebar header, which accepts no drops — the review's M6. Measured with
 *    the renderer guard disabled: the window still did not navigate, because
 *    Electron's `navigateOnDragDrop` defaults to false (now pinned in
 *    `HARDENED_WEB_PREFERENCES`). So this is a regression test for both
 *    layers rather than a reproduction; M6 does not reproduce as filed.
 *  - A real mouse click on an `<a href>` to an absolute local `.html`, the
 *    shape a shared thoughtbase's note can carry (H1).
 *
 * The page that would be navigated to sets a marker title, so "still on the
 * renderer" is checked by URL and by the app still answering.
 */
import { test, expect, type Page } from './helpers/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const EVIL_HTML = '<!DOCTYPE html><html><head><title>PWNED</title></head><body>evil</body></html>';

async function launch() {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-navguard-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-navguard-project-'));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-navguard-outside-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  const evilPath = path.join(outsideDir, 'evil.html');
  fs.writeFileSync(evilPath, EVIL_HTML);
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]),
  );
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  const cleanup = () => {
    for (const d of [userDataDir, projectDir, outsideDir]) fs.rmSync(d, { recursive: true, force: true });
  };
  return { app, evilPath, cleanup };
}

async function waitForWorkspace(win: Page): Promise<void> {
  await win.waitForLoadState('domcontentloaded');
  // A file-tree row, not "no Open Thoughtbase button": that passes on the
  // blank page before the app mounts.
  await expect(win.locator('[data-relative-path]').first()).toBeVisible({ timeout: 25_000 });
}

async function expectStillOnRenderer(win: Page, startUrl: string): Promise<void> {
  // Give a navigation, had one started, time to commit.
  await win.waitForTimeout(1000);
  expect(win.url()).toBe(startUrl);
  expect(await win.title()).not.toBe('PWNED');
  // Still the app: the file tree that was there at startup is still there.
  // (Not `.status-bar` — it sits in the editor pane and isn't always rendered.)
  await expect(win.locator('[data-relative-path]').first()).toBeVisible();
}

test('a file dropped where nothing accepts it does not navigate the window (#2554, M6)', async () => {
  const { app, evilPath, cleanup } = await launch();
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await waitForWorkspace(win);
    const startUrl = win.url();

    // Outside `.editor-pane` (which really imports a dropped file — the
    // status bar is inside it) and not a window drag region (the titlebar).
    const box = await win.locator('aside.sidebar .panel-header').first().boundingBox();
    expect(box).not.toBeNull();
    const x = box!.x + box!.width / 2;
    const y = box!.y + box!.height / 2;
    expect(await win.evaluate(([px, py]) => {
      const el = document.elementFromPoint(px, py);
      return !!el?.closest('aside.sidebar') && !el.closest('.file-list');
    }, [x, y])).toBe(true);

    const cdp = await win.context().newCDPSession(win);
    const data = { items: [], files: [evilPath], dragOperationsMask: 1 };
    await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
    await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
    await cdp.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });

    await expectStillOnRenderer(win, startUrl);
  } finally {
    await closeMinerva(app);
    cleanup();
  }
});

test('clicking a link to a local .html does not navigate the window (#2552, #2554)', async () => {
  const { app, evilPath, cleanup } = await launch();
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await waitForWorkspace(win);
    const startUrl = win.url();

    // Record whether the renderer guard cancelled the click — a bubbling
    // listener on window runs after the guard's capturing one on document.
    await win.evaluate((href) => {
      const a = document.createElement('a');
      a.id = 'e2e-evil-link';
      a.href = href;
      a.textContent = 'open';
      a.style.cssText = 'position:fixed;top:200px;left:300px;z-index:99999;padding:8px;background:#fff';
      document.body.appendChild(a);
      window.addEventListener('click', (e) => {
        (window as unknown as { __e2eDefaultPrevented: boolean }).__e2eDefaultPrevented = e.defaultPrevented;
      });
    }, evilPath);

    await win.locator('#e2e-evil-link').click();

    expect(await win.evaluate(() => (window as unknown as { __e2eDefaultPrevented: boolean }).__e2eDefaultPrevented)).toBe(true);
    await expectStillOnRenderer(win, startUrl);
  } finally {
    await closeMinerva(app);
    cleanup();
  }
});
