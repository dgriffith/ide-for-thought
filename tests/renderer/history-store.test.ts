/**
 * @vitest-environment happy-dom
 *
 * History store (#1834) — the seam the panel used to fake with a 700 ms timer.
 *
 * Pins: the `history:changed` subscription drives the refresh (and ignores
 * other notes), `watch` is idempotent so a panel can call it from an effect,
 * a late response for an abandoned note can't overwrite the current one, and
 * the three mutations gate on their dialogs.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  api: {
    history: {
      list: vi.fn(),
      restore: vi.fn(),
      setLabel: vi.fn(),
      onChanged: vi.fn(),
    },
  },
  showConfirm: vi.fn(),
  showPrompt: vi.fn(),
}));
vi.mock('../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../src/renderer/lib/stores/dialogs.svelte', () => ({
  getDialogStore: () => ({ showConfirm: h.showConfirm, showPrompt: h.showPrompt }),
}));

import { getHistoryStore } from '../../src/renderer/lib/stores/history.svelte';

/** The callback main would invoke on a `history:changed` broadcast. */
let fireChanged: (relPath: string | null) => void;

beforeEach(() => {
  h.api.history.list.mockResolvedValue([]);
  h.api.history.restore.mockResolvedValue(undefined);
  h.api.history.setLabel.mockResolvedValue(undefined);
  h.api.history.onChanged.mockImplementation((cb: (p: string | null) => void) => {
    fireChanged = cb;
    return () => {};
  });
});
afterEach(() => {
  getHistoryStore().watch(null);
  vi.clearAllMocks();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('history store (#1834)', () => {
  it('loads the watched note and exposes its revisions', async () => {
    h.api.history.list.mockResolvedValue([{ ts: 2, origin: 'edit' }, { ts: 1, origin: 'edit' }]);
    const store = getHistoryStore();
    store.watch('notes/a.md');
    await flush();

    expect(h.api.history.list).toHaveBeenCalledWith('notes/a.md');
    expect(store.revisions.map((r) => r.ts)).toEqual([2, 1]);
  });

  it('refreshes when the watched note changes underneath it — no polling', async () => {
    const store = getHistoryStore();
    store.watch('notes/a.md');
    await flush();
    h.api.history.list.mockClear();
    h.api.history.list.mockResolvedValue([{ ts: 3, origin: 'proposal', cause: 'Auto-tag' }]);

    // A save the renderer never asked for — an applied proposal, say.
    fireChanged('notes/a.md');
    await flush();

    expect(h.api.history.list).toHaveBeenCalledTimes(1);
    expect(store.revisions[0]?.cause).toBe('Auto-tag');
  });

  it('ignores a change to a different note', async () => {
    const store = getHistoryStore();
    store.watch('notes/a.md');
    await flush();
    h.api.history.list.mockClear();

    fireChanged('notes/somewhere-else.md');
    await flush();

    expect(h.api.history.list).not.toHaveBeenCalled();
  });

  it('refreshes on a null path — a prune sweep touched many notes', async () => {
    const store = getHistoryStore();
    store.watch('notes/a.md');
    await flush();
    h.api.history.list.mockClear();

    fireChanged(null);
    await flush();

    expect(h.api.history.list).toHaveBeenCalledWith('notes/a.md');
  });

  it('is idempotent, so a panel can call watch from an effect', async () => {
    const store = getHistoryStore();
    store.watch('notes/a.md');
    store.watch('notes/a.md');
    store.watch('notes/a.md');
    await flush();
    expect(h.api.history.list).toHaveBeenCalledTimes(1);
  });

  it('clears the list when no note is open', async () => {
    h.api.history.list.mockResolvedValue([{ ts: 1, origin: 'edit' }]);
    const store = getHistoryStore();
    store.watch('notes/a.md');
    await flush();
    expect(store.revisions).toHaveLength(1);

    store.watch(null);
    await flush();
    expect(store.revisions).toEqual([]);
  });

  it("does not let a slow response for an abandoned note overwrite the current one", async () => {
    let releaseSlow!: (v: unknown) => void;
    h.api.history.list.mockImplementationOnce(() => new Promise((r) => { releaseSlow = r; }));
    const store = getHistoryStore();
    store.watch('notes/slow.md');

    h.api.history.list.mockResolvedValue([{ ts: 9, origin: 'edit' }]);
    store.watch('notes/fast.md');
    await flush();
    expect(store.revisions.map((r) => r.ts)).toEqual([9]);

    // The abandoned note answers late; the panel must keep showing fast.md.
    releaseSlow([{ ts: 1, origin: 'edit' }]);
    await flush();
    expect(store.revisions.map((r) => r.ts)).toEqual([9]);
  });

  it('confirms before restoring, and reports a decline', async () => {
    const store = getHistoryStore();
    h.showConfirm.mockResolvedValue(false);
    expect(await store.restore('notes/a.md', 1)).toBe(false);
    expect(h.api.history.restore).not.toHaveBeenCalled();

    h.showConfirm.mockResolvedValue(true);
    expect(await store.restore('notes/a.md', 1)).toBe(true);
    expect(h.api.history.restore).toHaveBeenCalledWith('notes/a.md', 1);
  });

  it('seeds the label prompt with the existing name, and treats an emptied box as a clear', async () => {
    const store = getHistoryStore();
    h.showPrompt.mockResolvedValue('  ');
    await store.label('notes/a.md', 1, 'before refactor');

    expect(h.showPrompt).toHaveBeenCalledWith('Name this version:', 'before refactor');
    expect(h.api.history.setLabel).toHaveBeenCalledWith('notes/a.md', 1, null);
  });

  it('removes a label without prompting', async () => {
    const store = getHistoryStore();
    await store.removeLabel('notes/a.md', 1);
    expect(h.api.history.setLabel).toHaveBeenCalledWith('notes/a.md', 1, null);
    expect(h.showPrompt).not.toHaveBeenCalled();
    expect(h.showConfirm).not.toHaveBeenCalled();
  });
});
