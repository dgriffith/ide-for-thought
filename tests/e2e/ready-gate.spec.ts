/**
 * Playwright's ready gate (#2595). Its Electron loader holds `ready` until the
 * runner's fire-and-forget `__playwright_run()` lands. When that is lost, the
 * app never creates a window, and a later quit hangs too. That was about
 * 3 launches in ~900 on CI, on whichever spec happened to launch at the time.
 * The fixture loses the first release on purpose. `launchMinerva` must notice
 * that Electron is ready with the gate still closed, release it, and record
 * the repair, which the flake report raises as a ::warning.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, launchMinerva, projectRoot } from './helpers/launch';

test('a lost Playwright ready release is repaired and recorded, not a 20s window timeout (#2595)', async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-ready-gate-'));
  const app = await launchMinerva({
    userDataDir,
    env: { MINERVA_E2E: '1' },
    nodeArgs: ['-r', path.join(projectRoot, 'tests', 'e2e', 'fixtures', 'lose-first-ready-release.cjs')],
  });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toBeVisible({ timeout: 20_000 });
    expect(test.info().annotations.filter((a) => a.type === 'ready-gate-repaired')).toHaveLength(1);
  } finally {
    await closeMinerva(app);
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});
