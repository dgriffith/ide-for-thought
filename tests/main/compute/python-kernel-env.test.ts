/**
 * Regression test for `buildKernelEnv()` (#2105).
 *
 * `spawnKernel` used to inline the kernel subprocess's `env` object as a
 * 36-line literal mixed into launch-planning logic. This extracts it into a
 * standalone pure function so it's independently testable — a missed env var
 * here would silently break every compute cell, so the extraction itself is
 * pinned against the exact literal `spawnKernel` used to construct in place,
 * not just asserted indirectly via end-to-end kernel behavior.
 *
 * #2555 then removed PYTHONPATH and PYTHONUNBUFFERED on purpose: the kernel
 * runs with `-E -u`, and the root reaches sys.path only through the
 * bootstrap's append. The baseline below records that change.
 * #2560 replaced the inline `...process.env` with an allowlist
 * (`subprocess-env.ts`), so the baseline below spreads the allowlisted
 * source rather than the whole parent env — and a dedicated case pins that
 * the parent's credentials don't arrive.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';
import os from 'node:os';

const h = vi.hoisted(() => ({ root: '/repo/resources' }));

vi.mock('electron', () => ({
  app: { getPath: () => '' },
}));

// Packaged-vs-dev is `bundledResourcesRoot()`'s decision (#2410); stub it so
// both branches of PYTHONPATH can be exercised here.
vi.mock('../../../src/main/bundled-resources', () => ({
  bundledResourcesRoot: () => h.root,
}));

import { buildKernelEnv, pythonResourcesRoot } from '../../../src/main/compute/python-kernel';
import { allowlistedEnv, KERNEL_ENV_EXTRA } from '../../../src/main/subprocess-env';

beforeEach(() => {
  h.root = '/repo/resources';
});

/**
 * The `env:` literal `spawnKernel` built inline before the #2105 extraction,
 * minus the two PYTHON* variables #2555 dropped.
 */
function originalInlineEnv(rootPath: string, socketPath: string, allowNetwork: boolean): NodeJS.ProcessEnv {
  return {
    ...allowlistedEnv(process.env, KERNEL_ENV_EXTRA),
    MINERVA_IPC_SOCKET: socketPath,
    MINERVA_PROJECT_ROOT: rootPath,
    ...(allowNetwork ? { MINERVA_ALLOW_NETWORK: '1' } : {}),
    MPLBACKEND: 'Agg',
    MPLCONFIGDIR: path.join(os.tmpdir(), 'minerva-matplotlib'),
  };
}

describe('buildKernelEnv (#2105)', () => {
  it('matches the pre-extraction inline literal with network disallowed', () => {
    const rootPath = '/Users/test/my-project';
    const socketPath = '/tmp/minerva-kernel-abc.sock';
    const expected = originalInlineEnv(rootPath, socketPath, false);
    const actual = buildKernelEnv({ rootPath, socketPath, allowNetwork: false });
    expect(actual).toEqual(expected);
    expect(actual.MINERVA_ALLOW_NETWORK).toBeUndefined();
  });

  it('matches the pre-extraction inline literal with network allowed', () => {
    const rootPath = '/Users/test/other-project';
    const socketPath = '/tmp/minerva-kernel-def.sock';
    const expected = originalInlineEnv(rootPath, socketPath, true);
    const actual = buildKernelEnv({ rootPath, socketPath, allowNetwork: true });
    expect(actual).toEqual(expected);
    expect(actual.MINERVA_ALLOW_NETWORK).toBe('1');
  });

  it('sets no PYTHONPATH: the root must never be searched ahead of the stdlib (#2555)', () => {
    h.root = path.join('/fake', 'Resources', 'resources');
    const rootPath = '/Users/test/packaged-project';
    const actual = buildKernelEnv({ rootPath, socketPath: '/tmp/s.sock', allowNetwork: false });
    // Not set by Minerva, and an inherited one is dropped by the allowlist (#2560).
    expect(actual.PYTHONPATH).toBeUndefined();
    expect(String(actual.PYTHONPATH ?? '')).not.toContain(rootPath);
    expect(actual.MINERVA_PROJECT_ROOT).toBe(rootPath);
    // Still resolves the bundled package from the packaged resources root.
    expect(pythonResourcesRoot()).toBe(path.join('/fake', 'Resources', 'resources', 'python'));
  });

  it('does not hand the parent\'s credentials to the kernel (#2560)', () => {
    const source: NodeJS.ProcessEnv = {
      PATH: '/usr/bin', HOME: '/Users/me', VIRTUAL_ENV: '/Users/me/venv',
      ANTHROPIC_API_KEY: 'sk-ant-x', GH_TOKEN: 'ghp_x', AWS_SECRET_ACCESS_KEY: 's', ELECTRON_RUN_AS_NODE: '1',
    };
    const env = buildKernelEnv({ rootPath: '/r', socketPath: '/s.sock', allowNetwork: false }, source);
    expect(env).toMatchObject({ PATH: '/usr/bin', HOME: '/Users/me', VIRTUAL_ENV: '/Users/me/venv', MINERVA_PROJECT_ROOT: '/r' });
    for (const k of ['ANTHROPIC_API_KEY', 'GH_TOKEN', 'AWS_SECRET_ACCESS_KEY', 'ELECTRON_RUN_AS_NODE']) {
      expect(env[k], k).toBeUndefined();
    }
  });
});
