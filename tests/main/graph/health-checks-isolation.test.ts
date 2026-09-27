/**
 * @vitest-environment node
 *
 * One failing inspection must not blank the others (#2363).
 *
 * Since #2363 the checks' fixed queries go through `queryGraphRows`, which
 * throws on the query union's failure arm instead of returning empty rows.
 * Under `runAllChecks`' `Promise.all` that would let a single engine error
 * reject the whole run and empty the Inspections panel. Here EVERY graph query
 * throws, and the one check that needs no graph (unreferenced images, fed by
 * the injected scanner) must still report — and the failures must be logged,
 * not silently absorbed.
 */
import { describe, it, expect, vi } from 'vitest';

const h = vi.hoisted(() => ({
  queryGraphRows: vi.fn(async () => {
    throw new Error('engine exploded');
  }),
  headingsFor: vi.fn(async () => [] as string[]),
  warn: vi.fn(),
}));

vi.mock('../../../src/main/graph/index', () => ({
  queryGraphRows: h.queryGraphRows,
  headingsFor: h.headingsFor,
}));

vi.mock('../../../src/shared/logger', async (orig) => {
  const actual = await orig<typeof import('../../../src/shared/logger')>();
  return {
    ...actual,
    logger: (tag: string) => ({ ...actual.logger(tag), warn: h.warn }),
  };
});

import { runAllChecks } from '../../../src/main/graph/health-checks';
import { DEFAULT_INSPECTION_SETTINGS } from '../../../src/shared/inspections';
import { projectContext } from '../../../src/main/project-context-types';

describe('runAllChecks isolates a failing check (#2363)', () => {
  it('still returns the checks that succeeded, and logs the ones that failed', async () => {
    const ctx = projectContext('/fake-isolation-project');
    const results = await runAllChecks(ctx, DEFAULT_INSPECTION_SETTINGS, {
      findOrphanedAssets: async () => [{ relativePath: '.minerva/assets/inline/lonely.png', sizeBytes: 1 }],
    });

    expect(h.queryGraphRows).toHaveBeenCalled();
    expect(results.map((r) => r.type)).toEqual(['unreferenced_image']);
    expect(h.warn).toHaveBeenCalled();
    expect(String(h.warn.mock.calls[0]![0])).toMatch(/inspection '.+' failed/);
  });
});
