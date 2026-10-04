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

beforeEach(() => {
  h.root = '/repo/resources';
});

/**
 * The `env:` literal `spawnKernel` built inline before the #2105 extraction,
 * minus the two PYTHON* variables #2555 dropped.
 */
function originalInlineEnv(rootPath: string, socketPath: string, allowNetwork: boolean): NodeJS.ProcessEnv {
  return {
    ...process.env,
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
    expect(actual.PYTHONPATH).toBe(process.env.PYTHONPATH);
    expect(String(actual.PYTHONPATH ?? '')).not.toContain(rootPath);
    expect(actual.MINERVA_PROJECT_ROOT).toBe(rootPath);
    // Still resolves the bundled package from the packaged resources root.
    expect(pythonResourcesRoot()).toBe(path.join('/fake', 'Resources', 'resources', 'python'));
  });
});
