/**
 * Per-machine Python interpreter override + probe (#374).
 *
 * The settings store reads/writes a JSON file under `app.getPath('userData')`.
 * We stub `electron.app.getPath` to a temp directory so the suite is
 * hermetic and parallel-safe — and not dependent on having a real
 * Electron app context.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { execSync } from 'node:child_process';

let tempDir: string;

vi.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`unexpected getPath(${name})`);
      return tempDir;
    },
  },
}));

// Import after the mock so the module captures the stubbed `app`.
import {
  getPythonSettings,
  setPythonSettings,
  resolvePythonInterpreter,
  probePythonInterpreter,
} from '../../../src/main/compute/python-settings';
import {
  DEFAULT_CELL_TIMEOUT_SECONDS,
  MAX_CELL_TIMEOUT_SECONDS,
  normalizeCellTimeoutSeconds,
} from '../../../src/shared/compute/types';

beforeEach(async () => {
  tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-pysettings-'));
});

afterEach(async () => {
  await fs.rm(tempDir, { recursive: true, force: true });
});

describe('getPythonSettings (#374)', () => {
  it('returns an empty pythonPath when the file is missing', async () => {
    const s = await getPythonSettings();
    expect(s.pythonPath).toBe('');
  });

  it('reads a previously-saved pythonPath', async () => {
    await fs.writeFile(
      path.join(tempDir, 'python-settings.json'),
      JSON.stringify({ pythonPath: '/opt/python/3.11/bin/python3' }),
      'utf-8',
    );
    const s = await getPythonSettings();
    expect(s.pythonPath).toBe('/opt/python/3.11/bin/python3');
  });

  it('coerces non-string pythonPath fields to empty', async () => {
    await fs.writeFile(
      path.join(tempDir, 'python-settings.json'),
      JSON.stringify({ pythonPath: 42 as unknown as string }),
      'utf-8',
    );
    const s = await getPythonSettings();
    expect(s.pythonPath).toBe('');
  });

  it('defaults allowNetwork to false when absent (#1413)', async () => {
    const s = await getPythonSettings();
    expect(s.allowNetwork).toBe(false);
  });

  it('reads allowNetwork: true when set (#1413)', async () => {
    await fs.writeFile(
      path.join(tempDir, 'python-settings.json'),
      JSON.stringify({ pythonPath: '', allowNetwork: true }),
      'utf-8',
    );
    const s = await getPythonSettings();
    expect(s.allowNetwork).toBe(true);
  });

  it('fails closed — only a literal true enables network (#1413)', async () => {
    await fs.writeFile(
      path.join(tempDir, 'python-settings.json'),
      JSON.stringify({ pythonPath: '', allowNetwork: 'yes' }),
      'utf-8',
    );
    const s = await getPythonSettings();
    expect(s.allowNetwork).toBe(false);
  });
});

describe('setPythonSettings (#374)', () => {
  it('persists round-trip', async () => {
    await setPythonSettings({
      pythonPath: '/usr/local/bin/python3.12', allowNetwork: false,
      cellTimeoutSeconds: DEFAULT_CELL_TIMEOUT_SECONDS,
    });
    const reread = await getPythonSettings();
    expect(reread.pythonPath).toBe('/usr/local/bin/python3.12');
  });

  it('round-trips allowNetwork (#1413)', async () => {
    const base = { pythonPath: '', cellTimeoutSeconds: DEFAULT_CELL_TIMEOUT_SECONDS };
    await setPythonSettings({ ...base, allowNetwork: true });
    expect((await getPythonSettings()).allowNetwork).toBe(true);
    await setPythonSettings({ ...base, allowNetwork: false });
    expect((await getPythonSettings()).allowNetwork).toBe(false);
  });
});

describe('cell execution timeout (#2218)', () => {
  it('defaults to the standard budget when the key is absent', async () => {
    // Every settings file written before #2218 lacks the key. Reading that as
    // "0 — no limit" would leave every existing install with the unbounded
    // behaviour the ticket exists to remove, and nothing would say so.
    await fs.writeFile(
      path.join(tempDir, 'python-settings.json'),
      JSON.stringify({ pythonPath: '', allowNetwork: false }),
      'utf-8',
    );
    expect((await getPythonSettings()).cellTimeoutSeconds).toBe(DEFAULT_CELL_TIMEOUT_SECONDS);
  });

  it('an explicitly stored 0 means no limit — and survives a reread', async () => {
    // The one value a user can set that must NOT be replaced by the default,
    // which is why "absent" and "0" are decoded differently.
    await fs.writeFile(
      path.join(tempDir, 'python-settings.json'),
      JSON.stringify({ cellTimeoutSeconds: 0 }),
      'utf-8',
    );
    expect((await getPythonSettings()).cellTimeoutSeconds).toBe(0);
  });

  it('reads a stored budget', async () => {
    await fs.writeFile(
      path.join(tempDir, 'python-settings.json'),
      JSON.stringify({ cellTimeoutSeconds: 45 }),
      'utf-8',
    );
    expect((await getPythonSettings()).cellTimeoutSeconds).toBe(45);
  });

  it('round-trips through setPythonSettings', async () => {
    await setPythonSettings({ pythonPath: '', allowNetwork: false, cellTimeoutSeconds: 15 });
    expect((await getPythonSettings()).cellTimeoutSeconds).toBe(15);
  });

  it('normalizes a garbage stored value rather than trusting it', async () => {
    await fs.writeFile(
      path.join(tempDir, 'python-settings.json'),
      JSON.stringify({ cellTimeoutSeconds: 'soon' }),
      'utf-8',
    );
    expect((await getPythonSettings()).cellTimeoutSeconds).toBe(DEFAULT_CELL_TIMEOUT_SECONDS);
  });
});

describe('normalizeCellTimeoutSeconds (#2218)', () => {
  it('passes a plain positive value through', () => {
    expect(normalizeCellTimeoutSeconds(60)).toBe(60);
  });

  it('treats 0 and negatives as "no limit"', () => {
    // A negative in the file is nonsense; folding it into the documented 0 is
    // kinder than re-arming a limit the user was plainly removing.
    expect(normalizeCellTimeoutSeconds(0)).toBe(0);
    expect(normalizeCellTimeoutSeconds(-5)).toBe(0);
  });

  it('rounds a positive fraction UP, never down into "no limit"', () => {
    // Math.round(0.4) is 0, which would flip the meaning from "very short
    // limit" to "no limit at all" — the opposite of what was asked for.
    expect(normalizeCellTimeoutSeconds(0.4)).toBe(1);
    expect(normalizeCellTimeoutSeconds(1.2)).toBe(2);
  });

  it('rejects non-numbers and non-finite numbers', () => {
    expect(normalizeCellTimeoutSeconds(undefined)).toBe(0);
    expect(normalizeCellTimeoutSeconds('60')).toBe(0);
    expect(normalizeCellTimeoutSeconds(Number.NaN)).toBe(0);
    expect(normalizeCellTimeoutSeconds(Number.POSITIVE_INFINITY)).toBe(0);
  });

  it('clamps an absurd value below setTimeout\'s 32-bit ceiling', () => {
    // Node fires a timer whose delay exceeds 2^31-1 ms IMMEDIATELY. Without
    // the clamp, a user typing a huge number to mean "basically never" would
    // get "instantly" — every cell killed the moment it started.
    expect(normalizeCellTimeoutSeconds(1e12)).toBe(MAX_CELL_TIMEOUT_SECONDS);
    expect(MAX_CELL_TIMEOUT_SECONDS * 1000).toBeLessThan(2 ** 31 - 1);
  });
});

describe('resolvePythonInterpreter (#374) — discovery order', () => {
  // process.env is worker-global, so snapshot + restore at test time (not module
  // load time) to avoid cross-file order dependencies if a previous test file
  // didn't restore MINERVA_PYTHON.
  let originalEnv: string | undefined;
  beforeEach(() => {
    originalEnv = process.env.MINERVA_PYTHON;
  });
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.MINERVA_PYTHON;
    else process.env.MINERVA_PYTHON = originalEnv;
  });

  it('Settings override wins over env var and PATH default', async () => {
    await setPythonSettings({ pythonPath: '/explicit/override/python', allowNetwork: false });
    process.env.MINERVA_PYTHON = '/env/python';
    const r = await resolvePythonInterpreter();
    expect(r).toBe('/explicit/override/python');
  });

  it('falls back to MINERVA_PYTHON when no override is stored', async () => {
    process.env.MINERVA_PYTHON = '/env/python';
    const r = await resolvePythonInterpreter();
    expect(r).toBe('/env/python');
  });

  it('falls back to python3 when nothing is configured', async () => {
    delete process.env.MINERVA_PYTHON;
    const r = await resolvePythonInterpreter();
    expect(r).toBe('python3');
  });

  it('whitespace-only override does not satisfy the override branch', async () => {
    await setPythonSettings({ pythonPath: '   ', allowNetwork: false });
    delete process.env.MINERVA_PYTHON;
    const r = await resolvePythonInterpreter();
    expect(r).toBe('python3');
  });
});

describe('probePythonInterpreter (#374)', () => {
  function pythonOnPath(): boolean {
    try {
      execSync('python3 --version', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }
  const skipIfNoPython = pythonOnPath() ? it : it.skip;

  skipIfNoPython('returns ok + version for a real python on PATH', async () => {
    const r = await probePythonInterpreter('python3');
    // Narrowing, not optional-chaining: since #1878 the result is a
    // discriminated union, so `version` is guaranteed on this arm rather than
    // being a `string | undefined` every caller has to re-check.
    if (!r.ok) throw new Error(`expected a successful probe, got: ${r.error}`);
    expect(r.version).toMatch(/^Python \d+\.\d+/);
  });

  it('returns an error result for an obviously-bogus path', async () => {
    const r = await probePythonInterpreter('/not/a/real/python');
    if (r.ok) throw new Error(`expected a failed probe, got: ${r.version}`);
    expect(r.error).toBeTruthy();
    expect(r.path).toBe('/not/a/real/python');
  });

  skipIfNoPython('empty / whitespace candidate falls back to python3', async () => {
    const r = await probePythonInterpreter('   ');
    expect(r.ok).toBe(true);
    expect(r.path).toBe('python3');
  });
});
