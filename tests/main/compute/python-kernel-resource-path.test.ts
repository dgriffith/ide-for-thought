/**
 * Packaged-path resolution for the bundled Python kernel (#808).
 *
 * `extraResource: ['resources']` (forge.config.ts) copies the whole
 * `resources/` directory verbatim into the app bundle, so the packaged kernel
 * lands at `<Resources>/resources/python/minerva_kernel.py`. The resolver used
 * to drop the `resources/` segment, pointing at a path that doesn't exist in a
 * packaged build — silently breaking Python cells once shipped.
 *
 * Since #2410 the packaged-vs-dev decision (and the `resources/` nesting) is
 * `bundledResourcesRoot()`'s, pinned layout-by-layout in
 * `tests/main/bundled-resources.test.ts`. What this file pins is that the
 * kernel sits under that root — so the two can't drift apart again.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

const h = vi.hoisted(() => ({ root: '' }));

vi.mock('../../../src/main/bundled-resources', () => ({
  bundledResourcesRoot: () => h.root,
}));

import { pythonResourcesRoot, kernelScriptPath } from '../../../src/main/compute/python-kernel';

const PACKAGED_ROOT = path.join('/fake', 'Resources', 'resources');

beforeEach(() => {
  h.root = PACKAGED_ROOT;
});

describe('pythonResourcesRoot (#808)', () => {
  it('is <bundled resources>/python', () => {
    // Must be <Resources>/resources/python — NOT <Resources>/python (the bug).
    expect(pythonResourcesRoot()).toBe(path.join('/fake', 'Resources', 'resources', 'python'));
  });

  it('packaged kernel script path lands at resources/python/minerva_kernel.py', () => {
    expect(kernelScriptPath()).toBe(
      path.join('/fake', 'Resources', 'resources', 'python', 'minerva_kernel.py'),
    );
  });
});
