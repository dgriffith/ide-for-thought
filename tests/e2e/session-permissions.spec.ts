/**
 * Deny-by-default sessions and webContents (#2559), in real Electron.
 *
 * Electron auto-approves every permission in a session with no handler, and
 * lets any webContents with no window-open handler open windows. The
 * privileged-site login partition had neither — measured before the fix, a
 * page there got microphone, geolocation and notifications `granted` and
 * `window.open` succeeded. The fix is global (`installGlobalWebContentsGuards`
 * on `session-created` / `web-contents-created`), so this checks it the way a
 * new partition would meet it: one the app has never seen.
 *
 * And the other half: the main window keeps exactly its narrow grants —
 * microphone (dictation) and clipboard writes — so the global deny-all did
 * not land on the default session after `installPermissions` narrowed it.
 */
import { test, expect } from './helpers/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

test('a partition session denies every permission and popup; the main window keeps its grants (#2559)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-perms-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-perms-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]),
  );
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.locator('[data-relative-path]').first()).toBeVisible({ timeout: 25_000 });

    const main = await win.evaluate(async () => ({
      mic: (await navigator.permissions.query({ name: 'microphone' })).state,
      geo: (await navigator.permissions.query({ name: 'geolocation' })).state,
      clipboard: await navigator.clipboard.writeText('e2e').then(() => 'ok', (e: unknown) => String(e)),
    }));
    expect(main).toEqual({ mic: 'granted', geo: 'denied', clipboard: 'ok' });

    const partition = await test.step('fresh partition', () => app.evaluate(async ({ BrowserWindow }) => {
      const w = new BrowserWindow({
        show: false,
        webPreferences: { partition: 'persist:privileged-e2e-probe', sandbox: true, contextIsolation: true },
      });
      try {
        await w.loadURL('data:text/html,<p>probe</p>');
        return (await w.webContents.executeJavaScript(`(async () => ({
          mic: (await navigator.permissions.query({ name: 'microphone' })).state,
          camera: (await navigator.permissions.query({ name: 'camera' })).state,
          geo: (await navigator.permissions.query({ name: 'geolocation' })).state,
          notifications: (await navigator.permissions.query({ name: 'notifications' })).state,
          popup: window.open('https://example.com/') === null ? 'denied' : 'opened',
        }))()`)) as Record<string, string>;
      } finally {
        w.destroy();
      }
    }));
    expect(partition).toEqual({ mic: 'denied', camera: 'denied', geo: 'denied', notifications: 'denied', popup: 'denied' });
  } finally {
    await closeMinerva(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
