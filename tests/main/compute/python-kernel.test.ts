/**
 * Integration tests for the Python compute kernel (#241).
 *
 * These spawn the real kernel script through `python3` (or whatever
 * `MINERVA_PYTHON` points at). When neither is available the suite
 * skips itself rather than fails — kernel work is opt-in for CI that
 * doesn't have Python on PATH.
 */

import { describe, it, expect, afterAll } from 'vitest';
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

  it('non-JSON-serialisable result falls back to text/plain repr', async () => {
    // Sets aren't JSON-serialisable; under the MIME-bundle protocol
    // (#243) the kernel routes them through text/plain so they reach
    // the renderer as a 'text' output (was 'json' pre-#243).
    const r = await runPython(ROOT, 'repr.md', '{1, 2, 3}');
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'text') return;
    const repr = r.output.value;
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

  // ── Rich output (#243) ──────────────────────────────────────────────

  function pyModuleAvailable(mod: string): boolean {
    const bin = process.env.MINERVA_PYTHON ?? 'python3';
    try {
      execSync(`${bin} -c "import ${mod}"`, { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  const skipIfNoPandas = pyModuleAvailable('pandas') ? it : it.skip;
  const skipIfNoMatplotlib = pyModuleAvailable('matplotlib') ? it : it.skip;
  const skipIfNoPil = pyModuleAvailable('PIL') ? it : it.skip;

  skipIfNoPandas('pandas DataFrame → table output with columns + rows', async () => {
    const r = await runPython(ROOT, 'df.md', `
import pandas as pd
pd.DataFrame({'a': [1, 2, 3], 'b': ['x', 'y', 'z']})
    `.trim());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.output.type).toBe('table');
    if (r.output.type !== 'table') return;
    expect(r.output.columns).toEqual(['a', 'b']);
    expect(r.output.rows).toEqual([[1, 'x'], [2, 'y'], [3, 'z']]);
    // No truncation for 3 rows.
    expect(r.output.truncated).toBe(false);
    expect(r.output.totalRows).toBe(3);
  });

  skipIfNoPandas('pandas DataFrame > 1000 rows → truncated:true with totalRows preserved', async () => {
    const r = await runPython(ROOT, 'df-big.md', `
import pandas as pd
pd.DataFrame({'i': list(range(1500))})
    `.trim());
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'table') return;
    expect(r.output.rows.length).toBe(1000);
    expect(r.output.truncated).toBe(true);
    expect(r.output.totalRows).toBe(1500);
  });

  skipIfNoMatplotlib('matplotlib Figure as last expression → image/png output', async () => {
    const r = await runPython(ROOT, 'fig.md', `
import matplotlib
matplotlib.use('Agg')  # headless: no GUI backend in CI
import matplotlib.pyplot as plt
fig, ax = plt.subplots()
ax.plot([1, 2, 3], [1, 4, 9])
fig
    `.trim());
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'image') return;
    expect(r.output.mime).toBe('image/png');
    // base64-encoded PNGs always start with the magic-bytes signature
    // `iVBORw0KGgo` (decoding to 89 50 4E 47 0D 0A 1A 0A).
    expect(r.output.data.startsWith('iVBORw0KGgo')).toBe(true);
  });

  skipIfNoMatplotlib('Axes object also resolves to its parent Figure', async () => {
    const r = await runPython(ROOT, 'axes.md', `
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
fig, ax = plt.subplots()
ax.plot([1, 2, 3])
ax  # bare Axes — should still render as a PNG via fig
    `.trim());
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'image') return;
    expect(r.output.mime).toBe('image/png');
  });

  skipIfNoPil('PIL.Image as last expression → image/png output', async () => {
    const r = await runPython(ROOT, 'pil.md', `
from PIL import Image
Image.new('RGB', (8, 8), color='red')
    `.trim());
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'image') return;
    expect(r.output.mime).toBe('image/png');
    expect(r.output.data.startsWith('iVBORw0KGgo')).toBe(true);
  });

  it('object with _repr_html_ → html output', async () => {
    // Ad-hoc class — no third-party lib dependency.
    const r = await runPython(ROOT, 'reprhtml.md', `
class Bold:
    def _repr_html_(self):
        return '<b>hello</b>'
Bold()
    `.trim());
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'html') return;
    expect(r.output.html).toBe('<b>hello</b>');
  });

  it('object with _repr_svg_ → image/svg+xml output', async () => {
    const r = await runPython(ROOT, 'reprsvg.md', `
class Circle:
    def _repr_svg_(self):
        return '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="5" cy="5" r="4"/></svg>'
Circle()
    `.trim());
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'image') return;
    expect(r.output.mime).toBe('image/svg+xml');
    expect(r.output.data).toContain('<circle');
  });

  it('object with _repr_png_ → image/png output (bytes path)', async () => {
    // Construct an obviously-not-a-real PNG byte sequence to verify the
    // bytes-path takes precedence and the kernel base64-encodes it.
    const r = await runPython(ROOT, 'reprpng.md', `
class Tiny:
    def _repr_png_(self):
        return bytes([0x89, 0x50, 0x4E, 0x47])  # PNG magic prefix
Tiny()
    `.trim());
    expect(r.ok).toBe(true);
    if (!r.ok || r.output.type !== 'image') return;
    expect(r.output.mime).toBe('image/png');
    // base64 of bytes 89 50 4E 47 = "iVBORw=="
    expect(r.output.data).toBe('iVBORw==');
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
