/**
 * Execution deadlines, end to end against a real interpreter (#2218).
 *
 * `cell-deadline.test.ts` covers the policy with fake timers. This file is
 * here for the claims fake timers cannot make: that a SIGINT raised from a
 * `setTimeout` actually reaches a spinning Python process through the
 * sandbox wrapper, that the kernel answers it with `error` + `done` rather
 * than dying, and — the point of the whole ticket — that the project's OTHER
 * cells run afterwards instead of queueing forever behind a wedged kernel.
 *
 * It lives apart from `python-kernel.ts`'s main suite because it has to mock
 * `python-settings` (the real one reads `app.getPath('userData')`, and a
 * two-minute production default is not a thing a test can wait out), and a
 * module mock is file-scoped.
 *
 * Costs a few seconds of real wall clock on purpose. The budget is measured
 * against a process actually spinning; there is no way to fake that half.
 */

import { describe, it, expect, afterAll, vi } from 'vitest';
import { execSync } from 'node:child_process';

/**
 * Budget handed to the next `runPython` call, in seconds. Mutable so a single
 * kernel can run cells with different limits — reassign it BEFORE the call
 * whose budget it should govern, since `runPython` reads it once at submit.
 */
let budgetSeconds = 2;

vi.mock('../../../src/main/compute/python-settings', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../src/main/compute/python-settings')>();
  return {
    ...actual,
    getPythonSettings: async () => ({
      pythonPath: '',
      allowNetwork: false,
      cellTimeoutSeconds: budgetSeconds,
    }),
    // The real resolver reads the same (mocked-away) settings file; keep the
    // env-var / python3 half so the kernel still spawns something real.
    resolvePythonInterpreter: async () => process.env.MINERVA_PYTHON ?? 'python3',
  };
});

import {
  runPython,
  stopKernel,
  shutdownAllKernels,
  activeKernels,
} from '../../../src/main/compute/python-kernel';

function pythonAvailable(): boolean {
  const bin = process.env.MINERVA_PYTHON ?? 'python3';
  try {
    execSync(`${bin} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const skipIfNoPython = pythonAvailable() ? describe : describe.skip;

skipIfNoPython('python cell execution timeout (#2218)', () => {
  const ROOT = '/tmp/minerva-pyk-timeout-root';

  afterAll(async () => {
    await shutdownAllKernels();
  });

  it('an infinite loop is interrupted instead of hanging forever', async () => {
    budgetSeconds = 2;
    const started = Date.now();
    // The reproduction from the issue. Before #2218 this promise never
    // settled — the test would have hit the suite timeout instead.
    const r = await runPython(ROOT, 'hang.md', 'while True:\n    pass');
    const elapsed = Date.now() - started;

    expect(r.ok).toBe(false);
    if (r.ok) return;
    // The user-facing half: NOT the kernel's bare `KeyboardInterrupt: Cell
    // interrupted`, which is what the manual Interrupt command produces and
    // would leave the user with no idea why their cell stopped.
    expect(r.error).toMatch(/execution limit/i);
    expect(r.error).toMatch(/2s/);
    expect(r.error).not.toMatch(/KeyboardInterrupt/);
    // Roughly the budget, not the suite timeout. Loose upper bound: the
    // machine may be loaded, but 20s would mean the deadline never fired and
    // something else settled the promise.
    expect(elapsed).toBeGreaterThanOrEqual(1500);
    expect(elapsed).toBeLessThan(20_000);
  }, 30_000);

  it('the kernel survives the interrupt — later cells still run', async () => {
    // The actual defect in #2218 was never "one cell hangs"; it was that the
    // kernel stayed blocked inside exec_cell and every subsequent cell in the
    // project — including cells in OTHER notebooks — queued in the pipe
    // buffer behind it. Namespace state surviving proves the kernel was
    // interrupted rather than restarted.
    budgetSeconds = 30;
    await runPython(ROOT, 'survivor.md', 'marker = 99');

    budgetSeconds = 2;
    const hung = await runPython(ROOT, 'hang2.md', 'while True:\n    pass');
    expect(hung.ok).toBe(false);

    budgetSeconds = 30;
    const after = await runPython(ROOT, 'survivor.md', 'marker + 1');
    expect(after.ok).toBe(true);
    if (!after.ok || after.output.type !== 'json') return;
    expect(after.output.value).toBe(100);
  }, 30_000);

  it('a cell queued behind a long one is timed from when it RUNS, not when it was submitted', async () => {
    // Guards the head-of-queue rule against the obvious "arm on submit"
    // implementation. `slow` is given no limit and sleeps past `quick`'s
    // budget; `quick` is submitted while `slow` still holds the kernel. Arming
    // on submission would fire `quick`'s deadline mid-`slow`, SIGINT the cell
    // that was inside its budget, and report the wrong one as over.
    const root = '/tmp/minerva-pyk-timeout-queue-root';
    try {
      budgetSeconds = 0; // no limit for the slow cell
      const slow = runPython(root, 'slow.md', 'import time\ntime.sleep(4)\n"slow-done"');

      // Let the slow cell's request be read + started before the next one is
      // even submitted, so the queue order under test is unambiguous.
      await new Promise((resolve) => setTimeout(resolve, 1500));
      budgetSeconds = 2;
      const quick = runPython(root, 'quick.md', '"quick-done"');

      const [slowResult, quickResult] = await Promise.all([slow, quick]);

      expect(slowResult.ok).toBe(true);
      if (slowResult.ok && slowResult.output.type === 'text') {
        expect(slowResult.output.value).toBe('slow-done');
      }
      expect(quickResult.ok).toBe(true);
      if (quickResult.ok && quickResult.output.type === 'text') {
        expect(quickResult.output.value).toBe('quick-done');
      }
    } finally {
      await stopKernel(root);
    }
  }, 30_000);

  it('a cell that swallows the interrupt gets the kernel restarted', async () => {
    // SIGINT is not a guarantee: user code can catch KeyboardInterrupt, a C
    // extension may never return to the interpreter to check for signals, and
    // Windows has no supported child interrupt at all. Without the escalation
    // the project stays wedged exactly as it did before the fix — the
    // interrupt would just be a politer way of achieving nothing.
    const root = '/tmp/minerva-pyk-timeout-stubborn-root';
    try {
      budgetSeconds = 2;
      const r = await runPython(root, 'stubborn.md', [
        'import time',
        'while True:',
        '    try:',
        '        time.sleep(0.05)',
        '    except KeyboardInterrupt:',
        '        pass',
      ].join('\n'));

      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error).toMatch(/execution limit/i);
      expect(r.error).toMatch(/restarted/i);
      // The kernel slot is cleared, so the next cell lazy-spawns a fresh one
      // rather than writing into a dead process's stdin.
      expect(activeKernels()).not.toContain(root);

      budgetSeconds = 30;
      const recovered = await runPython(root, 'stubborn.md', 'print("alive")');
      expect(recovered.ok).toBe(true);
      if (!recovered.ok || recovered.output.type !== 'text') return;
      expect(recovered.output.value).toBe('alive');
    } finally {
      await stopKernel(root);
    }
  }, 30_000);

  it('a normal cell is untouched, and a zero budget disables the limit entirely', async () => {
    budgetSeconds = 30;
    const fast = await runPython(ROOT, 'fast.md', '6 * 7');
    expect(fast.ok).toBe(true);
    if (fast.ok && fast.output.type === 'json') expect(fast.output.value).toBe(42);

    // With the limit off, a cell that outlives what would have been the
    // budget still completes normally.
    budgetSeconds = 0;
    const unlimited = await runPython(ROOT, 'fast.md', 'import time\ntime.sleep(2.5)\n"finished"');
    expect(unlimited.ok).toBe(true);
    if (!unlimited.ok || unlimited.output.type !== 'text') return;
    expect(unlimited.output.value).toBe('finished');
  }, 30_000);
});
