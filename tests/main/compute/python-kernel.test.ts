/**
 * Integration tests for the Python compute kernel (#241).
 *
 * These spawn the real kernel script through `python3` (or whatever
 * `MINERVA_PYTHON` points at). When neither is available the suite
 * skips itself rather than fails — kernel work is opt-in for CI that
 * doesn't have Python on PATH.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import {
  runPython,
  stopKernel,
  restartKernel,
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

skipIfNoPython('python kernel (#241)', () => {
  // Use an arbitrary string — the kernel's per-project state is
  // keyed on it; we don't actually need a real directory.
  const ROOT = '/tmp/minerva-pyk-test-root';

  afterAll(async () => {
    await shutdownAllKernels();
  });

  it('end-to-end: a python fence runs and stdout comes back', async () => {
    const r = await runPython(ROOT, 'a.md', 'print("hi")');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.type).toBe('text');
    if (r.output.type !== 'text') return;
    expect(r.output.value).toBe('hi');
  });

  it('last-expression value comes back as a result (Jupyter-style)', async () => {
    const r = await runPython(ROOT, 'b.md', '1 + 2');
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'json') return;
    expect(r.output.value).toBe(3);
  });

  it('namespace persists across cells in the SAME notebook', async () => {
    const r1 = await runPython(ROOT, 'persist.md', 'x = 41\nx + 1');
    expect(r1.ok).toBe(true);
    if (!r1.ok || r1.output.type !== 'json') return;
    expect(r1.output.value).toBe(42);

    const r2 = await runPython(ROOT, 'persist.md', 'x * 2');
    expect(r2.ok).toBe(true);
    if (!r2.ok || r2.output.type !== 'json') return;
    expect(r2.output.value).toBe(82);
  });

  it('namespaces are isolated across notebooks', async () => {
    await runPython(ROOT, 'iso-a.md', 'secret = 7');
    const inA = await runPython(ROOT, 'iso-a.md', 'secret');
    expect(inA.ok).toBe(true);
    if (!inA.ok || inA.output.type !== 'json') return;
    expect(inA.output.value).toBe(7);

    // Different notebookPath ⇒ different namespace ⇒ NameError.
    const inB = await runPython(ROOT, 'iso-b.md', 'secret');
    expect(inB.ok).toBe(false);
    if (inB.ok) return;
    expect(inB.error).toMatch(/NameError/);
  });

  it('syntax error returns a structured error with traceback', async () => {
    const r = await runPython(ROOT, 'err.md', 'def f(:\n  pass');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/SyntaxError/);
  });

  it('runtime error returns a structured error with traceback', async () => {
    const r = await runPython(ROOT, 'err2.md', 'raise RuntimeError("nope")');
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/RuntimeError/);
    expect(r.error).toMatch(/nope/);
  });

  it('non-JSON-serialisable result falls back to repr', async () => {
    // Sets aren't JSON-serialisable; the kernel falls back to repr.
    const r = await runPython(ROOT, 'repr.md', '{1, 2, 3}');
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'json') return;
    // Set ordering isn't guaranteed; just check it's a stringified set
    // with the elements somewhere inside.
    expect(typeof r.output.value).toBe('string');
    const repr = String(r.output.value);
    expect(repr.startsWith('{')).toBe(true);
    expect(repr.endsWith('}')).toBe(true);
    for (const n of [1, 2, 3]) expect(repr).toContain(String(n));
  });

  it('restartKernel wipes namespaces and the next call respawns', async () => {
    await runPython(ROOT, 'restart.md', 'x = 100');
    const before = await runPython(ROOT, 'restart.md', 'x');
    expect(before.ok).toBe(true);

    await restartKernel(ROOT);
    expect(activeKernels()).not.toContain(ROOT);

    // Next call lazy-spawns; the prior `x` is gone.
    const after = await runPython(ROOT, 'restart.md', 'x');
    expect(after.ok).toBe(false);
    if (after.ok) return;
    expect(after.error).toMatch(/NameError/);
  });

  it('print without trailing newline still surfaces', async () => {
    const r = await runPython(ROOT, 'noeol.md', "import sys; sys.stdout.write('no-newline')");
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'text') return;
    expect(r.output.value).toBe('no-newline');
  });

  it('multiple statements: only the last expression value comes back as result; preceding stdout still goes', async () => {
    const r = await runPython(ROOT, 'multi.md', 'print("first")\nprint("second")\n2 + 2');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // result wins over stdout when the last stmt is an expression.
    expect(r.output.type).toBe('json');
    if (r.output.type !== 'json') return;
    expect(r.output.value).toBe(4);
  });

  it('kernel crash → next cell call auto-respawns', async () => {
    // Prime: get the kernel running for this project.
    await runPython(ROOT, 'crash.md', 'x = 1');
    expect(activeKernels()).toContain(ROOT);

    // os._exit(1) bypasses the kernel's exception handlers and tears
    // down the Python process — simulates a hard crash.
    const r = await runPython(ROOT, 'crash.md', 'import os; os._exit(1)');
    // The cell that triggered the crash gets a synthetic error since
    // the kernel exited before sending `done`.
    expect(r.ok).toBe(false);

    // Slot has been cleared by the exit handler; next call respawns.
    const recovered = await runPython(ROOT, 'crash.md', 'print("alive")');
    expect(recovered.ok).toBe(true);
    if (!recovered.ok || recovered.output.type !== 'text') return;
    expect(recovered.output.value).toBe('alive');
  });

  it('two projects keep independent kernels', async () => {
    const ROOT2 = ROOT + '-other';
    try {
      await runPython(ROOT, 'sep.md', 'shared = "in-A"');
      await runPython(ROOT2, 'sep.md', 'shared = "in-B"');

      const inA = await runPython(ROOT, 'sep.md', 'shared');
      const inB = await runPython(ROOT2, 'sep.md', 'shared');
      expect(inA.ok && inA.output.type === 'json' ? inA.output.value : null).toBe('in-A');
      expect(inB.ok && inB.output.type === 'json' ? inB.output.value : null).toBe('in-B');
    } finally {
      await stopKernel(ROOT2);
    }
  });
});
