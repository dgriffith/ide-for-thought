/**
 * OCR runs entirely from the bundle — no CDN (#2564).
 *
 * tesseract.js loads its worker script and WASM core from cdn.jsdelivr.net
 * unless told otherwise. Here every off-machine http(s) request the app makes
 * during the run is cancelled at the session (as if offline) and recorded,
 * and a real image-only PDF goes through the real ingest → OCR prompt → OCR
 * → save flow. The text must come out, and nothing may have tried the network.
 *
 * Electron-driver only (needs `app.evaluate` for the picker stub and the
 * request filter), like the other in-tree e2e specs.
 */
import { test, expect } from './helpers/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

const FIXTURE = path.join(projectRoot, 'tests', 'fixtures', 'ocr', 'scanned-page.pdf');

test('OCR of a scanned PDF works offline, with no CDN request (#2564)', async () => {
  test.setTimeout(120_000);
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-ocr-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-ocr-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  fs.writeFileSync(
    path.join(userDataDir, 'session.json'),
    JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]),
  );
  const sourcesDir = path.join(projectDir, '.minerva', 'sources');
  const before = new Set(fs.readdirSync(sourcesDir));

  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.locator('[data-relative-path]').first()).toBeVisible({ timeout: 25_000 });

    // Offline, and watching: cancel every request that would leave the machine.
    await app.evaluate(({ session, dialog }, fixture) => {
      const g = globalThis as typeof globalThis & { __e2eBlocked?: string[] };
      g.__e2eBlocked = [];
      session.defaultSession.webRequest.onBeforeRequest((details, cb) => {
        const u = new URL(details.url);
        const local = u.protocol !== 'http:' && u.protocol !== 'https:' || ['localhost', '127.0.0.1'].includes(u.hostname);
        if (!local) g.__e2eBlocked!.push(details.url);
        cb({ cancel: !local });
      });
      dialog.showOpenDialog = () => Promise.resolve({ canceled: false, filePaths: [fixture] });
    }, FIXTURE);

    await app.evaluate(({ BrowserWindow }) => {
      BrowserWindow.getAllWindows()[0]!.webContents.send('menu:ingestFile');
    });

    await expect(win.getByText(/Run OCR on/)).toBeVisible({ timeout: 20_000 });
    await win.getByRole('button', { name: 'Run OCR', exact: true }).click();

    // OCR finishes and the source body is written.
    let bodyText = '';
    await expect.poll(() => {
      const added = fs.readdirSync(sourcesDir).filter((d) => !before.has(d));
      const body = added.map((d) => path.join(sourcesDir, d, 'body.md')).find((p) => fs.existsSync(p));
      bodyText = body ? fs.readFileSync(body, 'utf-8') : '';
      // Not /scanned/: the placeholder body is titled after the file ("# scanned-page").
      return /Minerva/i.test(bodyText);
    }, { timeout: 90_000, message: 'OCR text never reached body.md' }).toBe(true);
    expect(bodyText).toMatch(/reads/i);

    const blocked = await app.evaluate(() => (globalThis as typeof globalThis & { __e2eBlocked?: string[] }).__e2eBlocked ?? []);
    expect(blocked, 'requests that tried to leave the machine').toEqual([]);
  } finally {
    await closeMinerva(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
    fs.rmSync(projectDir, { recursive: true, force: true });
  }
});
