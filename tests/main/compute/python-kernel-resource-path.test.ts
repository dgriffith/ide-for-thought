/**
 * Packaged-path resolution for the bundled Python kernel (#808).
 *
 * `extraResource: ['resources']` (forge.config.ts) copies the whole
 * `resources/` directory verbatim into the app bundle, so the packaged kernel
 * lands at `<Resources>/resources/python/minerva_kernel.py`. The resolver used
 * to drop the `resources/` segment, pointing at a path that doesn't exist in a
 * packaged build — silently breaking Python cells once shipped. These tests pin
 * both branches so it can't regress.
 */

import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest';
import path from 'node:path';

const h = vi.hoisted(() => ({ isPackaged: false }));

vi.mock('electron', () => ({
  app: {
    get isPackaged() { return h.isPackaged; },
    getPath: () => '',
  },
}));

import { pythonResourcesRoot, kernelScriptPath } from '../../../src/main/compute/python-kernel';

const originalResourcesPath = process.resourcesPath;

beforeEach(() => {
  h.isPackaged = false;
});

afterAll(() => {
  (process as { resourcesPath?: string }).resourcesPath = originalResourcesPath;
});

describe('pythonResourcesRoot (#808)', () => {
  it('dev build resolves under cwd/resources/python', () => {
    h.isPackaged = false;
    expect(pythonResourcesRoot()).toBe(path.join(process.cwd(), 'resources', 'python'));
  });

  it('packaged build includes the resources/ nesting extraResource produces', () => {
    h.isPackaged = true;
    (process as { resourcesPath?: string }).resourcesPath = path.join('/fake', 'Resources');
    // Must be <Resources>/resources/python — NOT <Resources>/python (the bug).
    expect(pythonResourcesRoot()).toBe(path.join('/fake', 'Resources', 'resources', 'python'));
  });

  it('packaged kernel script path lands at resources/python/minerva_kernel.py', () => {
    h.isPackaged = true;
    (process as { resourcesPath?: string }).resourcesPath = path.join('/fake', 'Resources');
    expect(kernelScriptPath()).toBe(
      path.join('/fake', 'Resources', 'resources', 'python', 'minerva_kernel.py'),
    );
  });
});
