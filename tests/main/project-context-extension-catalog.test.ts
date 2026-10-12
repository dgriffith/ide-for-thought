/**
 * The extension-catalog refresh never takes project open down with it
 * (#2618): when gathering the contributions fails, open and the focus-time
 * refresh both log and carry on.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

const h = vi.hoisted(() => ({ warn: vi.fn() }));

vi.mock('../../src/main/extension-contributions', () => ({
  refreshExtensionContributions: () => Promise.reject(new Error('catalog unreadable')),
}));
vi.mock('../../src/shared/logger', async () => {
  const actual = await vi.importActual<typeof import('../../src/shared/logger')>('../../src/shared/logger');
  return {
    ...actual,
    logger: (tag: string) => (tag === 'project-context'
      ? { debug: () => {}, info: () => {}, warn: h.warn, error: () => {} }
      : actual.logger(tag as never)),
  };
});

import { acquireProject, releaseProject, refreshOpenExtensionCatalogs } from '../../src/main/project-context';

describe('extension catalog refresh failures (#2618)', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-catalog-failure-'));
  afterEach(async () => {
    await releaseProject(root, 1);
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('open and the focus refresh both log and carry on', async () => {
    await expect(acquireProject(root, 1)).resolves.toBeTruthy();
    await vi.waitFor(() => expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('extension catalog refresh failed'), expect.any(Error)));
    h.warn.mockClear();
    refreshOpenExtensionCatalogs();
    await vi.waitFor(() => expect(h.warn).toHaveBeenCalledWith(expect.stringContaining('extension catalog refresh failed'), expect.any(Error)));
  });
});
