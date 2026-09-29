/**
 * The `test` every Minerva-launching e2e spec imports (#2458).
 *
 * Playwright's own `test`, plus one auto fixture: when a test ends — passed,
 * failed, or TIMED OUT — any Minerva it launched that is still running goes
 * through `closeMinerva` (bounded close, then SIGKILL, loudly).
 *
 * The timed-out case is why this is a fixture and not just the `finally` in
 * each spec: a test that times out is abandoned mid-await, so its `finally`
 * never runs. Before this, the app it launched was left for Playwright's worker
 * teardown to close gracefully, and a wedged main process made THAT hang too —
 * "Worker teardown timeout of 60000ms exceeded", an error outside any test that
 * failed the job even though the retry passed (#2458). Fixture teardown runs on
 * a timeout; the kill happens here, is annotated on the attempt, and the
 * failure stays a test failure the flake budget (#2379) can count.
 *
 * It also settles the Electron trace `launch.ts` records under `use.trace`:
 * attached when the attempt failed and the mode keeps it, deleted otherwise.
 *
 * `tests/architecture/e2e-launch-hygiene.test.ts` holds that every spec calling
 * `launchMinerva` imports `test` from here.
 */
import { test as base } from '@playwright/test';
import { closeMinerva, liveMinervaApps, settleTraces } from './launch';

export { expect } from '@playwright/test';
export type { ElectronApplication, Page, ConsoleMessage } from '@playwright/test';

export const test = base.extend<{ reapMinerva: void }>({
  reapMinerva: [
    // eslint-disable-next-line no-empty-pattern -- Playwright fixtures must destructure their deps
    async ({}, use) => {
      await use();
      for (const app of liveMinervaApps()) await closeMinerva(app, 'the post-test reaper');
      await settleTraces();
    },
    { auto: true },
  ],
});
