/**
 * A shared note's remote image doesn't phone home when it's opened (#1332).
 * The note (`writeRemoteBeaconNote`) has a markdown image on a host the reader
 * never allowed, and one already in the thoughtbase's image cache. Opening it:
 * no request to the beacon's host, a placeholder naming it, and the cached one
 * drawn (that makes no request). "Load images from <host>" records the host.
 *
 * Main's own fetch is gated where the policy is (register-images.test.ts);
 * this watches the window, which never gets a remote URL in an `<img>`.
 */
import { test, expect } from './helpers/test';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';
import { BEACON_HOST, writeRemoteBeaconNote } from '../helpers/hostile-content';

test('a shared note\'s remote image makes no request until its host is allowed (#1332)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-beacon-userdata-'));
  const projectDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-beacon-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), projectDir, { recursive: true });
  const rel = writeRemoteBeaconNote(projectDir);
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: projectDir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    // Every request the window makes to the beacon's host, answered so a
    // stray one wouldn't hang: the count is what matters.
    const beaconRequests: string[] = [];
    await win.route(`https://${BEACON_HOST}/**`, (route) => {
      beaconRequests.push(route.request().url());
      void route.fulfill({ status: 204 });
    });

    const row = win.locator(`[data-relative-path="${rel}"]`).first();
    await expect(row).toBeVisible({ timeout: 25_000 });
    await row.click();
    await win.getByRole('button', { name: 'Preview', exact: true }).click();
    const preview = win.locator('.preview').first();

    await test.step('opened: a placeholder naming the host, the cached image drawn, no request', async () => {
      const placeholder = preview.getByRole('group', { name: `Image from ${BEACON_HOST}, not loaded` });
      await expect(placeholder).toBeVisible({ timeout: 10_000 });
      await expect(preview.locator('img[alt="cached"]')).toHaveAttribute('src', /^data:image\/png;base64,/, { timeout: 10_000 });
      // No <img> in the preview carries a remote URL.
      const srcs = await preview.locator('img').evaluateAll((imgs) => imgs.map((i) => i.getAttribute('src') ?? ''));
      expect(srcs.filter((s) => /^https?:|^\/\//.test(s))).toEqual([]);
      await win.waitForTimeout(500);
      expect(beaconRequests).toEqual([]);
    });

    await test.step('"Load images from <host>" records the host for this thoughtbase', async () => {
      await preview.getByRole('button', { name: `Load images from ${BEACON_HOST}` }).click();
      await expect(preview.getByRole('group', { name: `Image from ${BEACON_HOST}, not loaded` })).toHaveCount(0, { timeout: 10_000 });
      const stored = JSON.parse(fs.readFileSync(path.join(userDataDir, 'remote-images.json'), 'utf-8')) as { thoughtbases: Record<string, { hosts: string[] }> };
      expect(Object.values(stored.thoughtbases)[0]!.hosts).toEqual([BEACON_HOST]);
      // The window still made no request itself: main fetches, from its own process.
      expect(beaconRequests).toEqual([]);
    });
  } finally {
    await closeMinerva(app);
    for (const d of [userDataDir, projectDir]) fs.rmSync(d, { recursive: true, force: true });
  }
});
