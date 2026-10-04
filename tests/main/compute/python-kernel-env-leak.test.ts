/**
 * A notebook cell can't read the API keys and tokens in Minerva's own
 * environment (#2560). Spawns the real (sandboxed, on macOS) kernel with
 * credentials set in main's `process.env` and asks the cell what it sees.
 * Skips without a Python, like the other kernel integration suites.
 */
import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { execSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runPython, shutdownAllKernels } from '../../../src/main/compute/python-kernel';

function pythonAvailable(): boolean {
  try {
    execSync(`${process.env.MINERVA_PYTHON ?? 'python3'} --version`, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

const SECRETS = {
  ANTHROPIC_API_KEY: 'sk-ant-kernel-leak-canary',
  OPENAI_API_KEY: 'sk-kernel-leak-canary',
  GH_TOKEN: 'ghp_kernel_leak_canary',
  AWS_SECRET_ACCESS_KEY: 'aws-kernel-leak-canary',
};

(pythonAvailable() ? describe : describe.skip)('python kernel env is allowlisted (#2560)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-pyenv-leak-'));
  const saved = Object.fromEntries(Object.keys(SECRETS).map((k) => [k, process.env[k]]));

  beforeAll(() => { Object.assign(process.env, SECRETS); });
  afterAll(async () => {
    await shutdownAllKernels();
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('a cell\'s os.environ has PATH and Minerva\'s own vars, and none of main\'s credentials', async () => {
    const r = await runPython(root, 'a.md', 'import os, json; json.dumps(dict(os.environ))');
    if (!r.ok || r.output.type !== 'json') throw new Error(`cell failed: ${JSON.stringify(r)}`);
    const env = JSON.parse(r.output.value as string) as Record<string, string>;
    expect(env.PATH).toBeTruthy();
    expect(env.MINERVA_PROJECT_ROOT).toBe(root);
    for (const [k, v] of Object.entries(SECRETS)) {
      expect(env[k], k).toBeUndefined();
      expect(Object.values(env)).not.toContain(v);
    }
  });
});
