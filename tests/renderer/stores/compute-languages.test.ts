/**
 * @vitest-environment happy-dom
 *
 * Which compute languages can run here (#2822): every runnable one until
 * main answers, then main's registered list, read again on plugins:changed.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { flushSync } from 'svelte';

const h = vi.hoisted(() => ({ languages: vi.fn(), changed: null as null | (() => void) }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    compute: { languages: h.languages },
    plugins: { onChanged: (cb: () => void) => { h.changed = cb; return () => undefined; } },
  },
}));

import { _resetComputeLanguagesForTests, computeLanguagesStore } from '../../../src/renderer/lib/stores/compute-languages.svelte';

const settle = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  _resetComputeLanguagesForTests();
  h.changed = null;
  h.languages.mockReset();
});

describe('computeLanguagesStore (#2822)', () => {
  it('before main answers, every runnable language counts as available', () => {
    h.languages.mockReturnValue(new Promise(() => {}));
    expect(computeLanguagesStore.isRunnable('python')).toBe(true);
    expect(computeLanguagesStore.isTurnedOff('python')).toBe(false);
  });

  it('then follows what main has registered: Python off, its aliases with it, SQL on', async () => {
    h.languages.mockResolvedValue(['sparql', 'sql']);
    computeLanguagesStore.isRunnable('sql');
    await settle();
    flushSync();
    expect(computeLanguagesStore.isRunnable('python')).toBe(false);
    expect(computeLanguagesStore.isTurnedOff('PY')).toBe(true);
    expect(computeLanguagesStore.isRunnable('sql')).toBe(true);
    // Not a compute language at all isn't "turned off".
    expect(computeLanguagesStore.isTurnedOff('javascript')).toBe(false);
  });

  it('asks again when the plugins change', async () => {
    h.languages.mockResolvedValueOnce(['sparql', 'sql']).mockResolvedValueOnce(['py', 'python', 'python3', 'sparql', 'sql']);
    computeLanguagesStore.isRunnable('sql');
    await settle();
    expect(computeLanguagesStore.isRunnable('python')).toBe(false);
    h.changed!();
    await settle();
    expect(computeLanguagesStore.isRunnable('python')).toBe(true);
    expect(h.languages).toHaveBeenCalledTimes(2);
  });
});
