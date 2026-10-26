/**
 * The plugin worker host (#2830), in the packaged app: a fixture plugin's
 * logic module runs in a Web Worker in a hidden, sandboxed host on its own
 * origin. Data goes in and out; it reads only the notes a call gives it; it
 * has no `require`, no `process`, no DOM, no `window.api` and no network; a
 * model request can't reach past its scope or approve what it filed; a
 * handler that throws fails its call with the message; one registered late
 * still answers; and one that loops forever is stopped at its deadline —
 * the app answering throughout — and the next call starts a fresh host.
 */
import { test, expect } from './helpers/test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { closeMinerva, invokePluginLogic, launchMinerva, projectRoot, servePluginWorker } from './helpers/launch';

const FIXTURE = path.join(projectRoot, 'tests', 'fixtures', 'hostile-plugins', 'worker');

test("a plugin's logic runs in its sandboxed worker host, bounded by its deadline (#2830)", async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-worker-host-userdata-'));
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-worker-host-project-'));
  fs.cpSync(path.join(projectRoot, 'tests', 'fixtures', 'sample-project'), dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'given.md'), '# Given\n\nA note the call hands over.\n');
  fs.writeFileSync(path.join(dir, 'withheld.md'), '# Withheld\n');
  const pluginDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-worker-host-plugin-'));
  fs.cpSync(FIXTURE, pluginDir, { recursive: true });
  fs.writeFileSync(path.join(userDataDir, 'session.json'), JSON.stringify([{ x: 80, y: 80, width: 1200, height: 800, rootPath: dir }]));
  const app = await launchMinerva({ userDataDir, env: { MINERVA_E2E: '1' } });
  try {
    const win = await app.firstWindow({ timeout: 20_000 });
    await expect(win.getByRole('button', { name: 'Open Thoughtbase' })).toHaveCount(0, { timeout: 25_000 });
    // The thoughtbase open, not just the welcome screen gone.
    await expect(win.locator('[data-relative-path="given.md"]').first()).toBeVisible({ timeout: 15_000 });
    await servePluginWorker(app, 'logic-lab', pluginDir, 'logic.js', ['notes:read', 'llm:propose']);

    await test.step('data in, data out — the first call starts the host', async () => {
      expect(await invokePluginLogic(app, 'logic-lab', 'echo', { n: 1, s: 'x' })).toEqual({ result: { echoed: { n: 1, s: 'x' } } });
    });

    await test.step('it reads the notes the call gives it, and no others', async () => {
      expect(await invokePluginLogic(app, 'logic-lab', 'readNote', { path: 'given.md' }, { scope: ['given.md'] }))
        .toEqual({ result: { path: 'given.md', length: expect.any(Number) } });
      const refused = await invokePluginLogic(app, 'logic-lab', 'readNote', { path: 'withheld.md' }, { scope: ['given.md'] });
      expect(refused.error).toMatch(/not one of the notes this view was given/);
    });

    await test.step('no require, process, node:fs, DOM, window.api, fetch or socket', async () => {
      expect(await invokePluginLogic(app, 'logic-lab', 'probe', {})).toEqual({
        result: {
          require: 'undefined', process: 'undefined', document: 'undefined', api: 'undefined', fetched: 'blocked: TypeError',
          importFs: expect.stringMatching(/^blocked: /), websocket: expect.stringMatching(/^blocked/),
        },
      });
    });

    await test.step('llmOverreach: a model request about a note it wasn\'t given, or .minerva/, is refused, and it can\'t approve anything (#2858)', async () => {
      expect(await invokePluginLogic(app, 'logic-lab', 'llmOverreach', {}, { scope: ['given.md'] })).toEqual({
        result: { withheld: 'scope', minervaData: 'scope', approve: 'unknown-method', approvalEngine: 'unknown-method' },
      });
    });

    await test.step('a handler that throws fails its call, naming the plugin; one registered late still answers', async () => {
      expect((await invokePluginLogic(app, 'logic-lab', 'fails', {})).error).toBe('Hostile fixture: the parser choked on line 3');
      expect(await invokePluginLogic(app, 'logic-lab', 'late', {})).toEqual({ result: 'late but here' });
    });

    await test.step('the host is one renderer process; record its memory', async () => {
      const procs = await app.evaluate(({ app: a }) => a.getAppMetrics().filter((m) => m.type === 'Tab').map((m) => m.memory.workingSetSize));
      // The app window and the host, at least: recorded, not gated (it varies by machine).
      expect(procs.length).toBeGreaterThanOrEqual(2);
      console.log(`[worker-host] renderer working sets (KB): ${procs.join(', ')}`);
    });

    await test.step('a loop is stopped at its deadline, the app answering throughout; the next call gets a fresh host', async () => {
      const t0 = Date.now();
      const looped = await invokePluginLogic(app, 'logic-lab', 'spin', {}, { deadlineMs: 1500 });
      expect(looped.error).toMatch(/didn't answer "spin" within 1.5s, so it was stopped/);
      expect(Date.now() - t0).toBeLessThan(5000);
      // The window still answers.
      await expect(win.locator('body')).toBeVisible();
      expect(await win.evaluate(() => 1 + 1)).toBe(2);
      expect(await invokePluginLogic(app, 'logic-lab', 'echo', { again: true })).toEqual({ result: { echoed: { again: true } } });
    });
  } finally {
    await closeMinerva(app);
  }
});
