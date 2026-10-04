/**
 * A thoughtbase can't run code in the kernel by shadowing Python (#2555).
 *
 * The root used to reach the interpreter through PYTHONPATH (ahead of the
 * stdlib, and searched for `sitecustomize` at startup) and was then inserted
 * at sys.path[1] by the bootstrap. A shared thoughtbase carrying
 * `sitecustomize.py` or `json.py` ran on the first consented cell — even
 * `1 + 1` — and a `socket.py` replaced the module the network guard patches.
 *
 * Spawns the real kernel (sandboxed on macOS, like production) against a root
 * holding every shadow module from `writePythonShadowThoughtbase`. Skips
 * without a Python, like the other kernel integration suites.
 */
import { describe, it, expect, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPython, shutdownAllKernels } from '../../../src/main/compute/python-kernel';
import { PYTHON_SHADOW_MODULES, writePythonShadowThoughtbase } from '../../helpers/hostile-thoughtbase';

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

skipIfNoPython('python kernel ignores thoughtbase stdlib shadows (#2555)', () => {
  const fixture = writePythonShadowThoughtbase(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-pyshadow-')));

  afterAll(async () => {
    await shutdownAllKernels();
    fs.rmSync(fixture.root, { recursive: true, force: true });
  });

  async function value(code: string): Promise<unknown> {
    const r = await runPython(fixture.root, 'a.md', code);
    if (!r.ok) throw new Error(`cell failed: ${JSON.stringify(r)}`);
    if (r.output.type !== 'json') throw new Error(`expected a json result, got ${r.output.type}`);
    return r.output.value;
  }

  it('a trivial consented cell runs none of the planted modules', async () => {
    expect(await value('1 + 1')).toBe(2);
    for (const name of PYTHON_SHADOW_MODULES) {
      expect(fs.existsSync(fixture.canaries[name]), `${name}.py ran`).toBe(false);
    }
  });

  it('stdlib imports from a cell resolve to the real stdlib, not the root', async () => {
    for (const mod of ['json', 'socket', 'base64']) {
      const file = await value(`import ${mod}; ${mod}.__file__`);
      expect(typeof file, mod).toBe('string');
      expect((file as string).startsWith(fixture.root), `${mod} -> ${String(file)}`).toBe(false);
    }
    for (const name of PYTHON_SHADOW_MODULES) {
      expect(fs.existsSync(fixture.canaries[name]), `${name}.py ran`).toBe(false);
    }
  });

  it('a user module at the root is still importable, after the stdlib on sys.path', async () => {
    expect(await value(`import ${fixture.userModule}; ${fixture.userModule}.VALUE`)).toBe(42);
    expect(await value('import sys; sys.path.index(' + JSON.stringify(fixture.root) + ') > sys.path.index(next(p for p in sys.path if p.endswith("lib-dynload")))')).toBe(true);
  });

  it('the bundled minerva package still wins sys.path[0]', async () => {
    const file = await value('import minerva; minerva.__file__');
    expect(file as string).toMatch(/resources[/\\]python[/\\]minerva[/\\]__init__\.py$/);
  });
});
