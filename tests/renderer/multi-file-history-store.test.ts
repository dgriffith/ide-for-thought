/**
 * @vitest-environment happy-dom
 *
 * Multi-file/directory local history store (#2092) — the renderer half of
 * the #2088 epic's unified timeline + batch revert backend (#2090, #2091).
 *
 * Pins: `openFor` loads the merged timeline for the given targets, the
 * `HISTORY_CHANGED` subscription refreshes only while open and only for a
 * relevant path (or a null sweep), a late response can't repopulate a closed
 * dialog, and `revert` gates on confirmation like the single-note store's
 * `restore` does.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({
  api: {
    history: {
      listUnified: vi.fn(),
      batchRevert: vi.fn(),
      onChanged: vi.fn(),
    },
  },
  showConfirm: vi.fn(),
}));
vi.mock('../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../src/renderer/lib/stores/dialogs.svelte', () => ({
  getDialogStore: () => ({ showConfirm: h.showConfirm }),
}));

import { getMultiFileHistoryStore } from '../../src/renderer/lib/stores/multi-file-history.svelte';

let fireChanged: (relPath: string | null) => void;

beforeEach(() => {
  h.api.history.listUnified.mockResolvedValue([]);
  h.api.history.batchRevert.mockResolvedValue({
    ts: 0, reverted: [], recreated: [], removed: [], unchanged: [], skipped: [], errors: [],
  });
  h.api.history.onChanged.mockImplementation((cb: (p: string | null) => void) => {
    fireChanged = cb;
    return () => {};
  });
  h.showConfirm.mockResolvedValue(true);
});
afterEach(() => {
  getMultiFileHistoryStore().close();
  vi.clearAllMocks();
});

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('multi-file history store (#2092)', () => {
  it('opens with the given targets and loads the merged timeline', async () => {
    h.api.history.listUnified.mockResolvedValue([
      { ts: 2, origin: 'edit', path: 'notes/a.md', event: 'modified' },
    ]);
    const store = getMultiFileHistoryStore();
    await store.openFor(['notes/a.md'], [{ relativePath: 'notes', isDirectory: true }]);

    expect(h.api.history.listUnified).toHaveBeenCalledWith(
      ['notes/a.md'],
      [{ relativePath: 'notes', isDirectory: true }],
    );
    expect(store.open).toBe(true);
    expect(store.timeline).toEqual([{ ts: 2, origin: 'edit', path: 'notes/a.md', event: 'modified' }]);
  });

  it('refreshes on a relevant change while open', async () => {
    const store = getMultiFileHistoryStore();
    await store.openFor(['notes/a.md'], []);
    h.api.history.listUnified.mockClear();

    fireChanged('notes/a.md');
    await flush();

    expect(h.api.history.listUnified).toHaveBeenCalledTimes(1);
  });

  it('ignores a change to an unrelated path', async () => {
    const store = getMultiFileHistoryStore();
    await store.openFor(['notes/a.md'], []);
    h.api.history.listUnified.mockClear();

    fireChanged('notes/elsewhere.md');
    await flush();

    expect(h.api.history.listUnified).not.toHaveBeenCalled();
  });

  it('refreshes on a null sweep', async () => {
    const store = getMultiFileHistoryStore();
    await store.openFor(['notes/a.md'], []);
    h.api.history.listUnified.mockClear();

    fireChanged(null);
    await flush();

    expect(h.api.history.listUnified).toHaveBeenCalledTimes(1);
  });

  it('ignores changes while closed', async () => {
    const store = getMultiFileHistoryStore();
    await store.openFor(['notes/a.md'], []);
    store.close();
    h.api.history.listUnified.mockClear();

    fireChanged('notes/a.md');
    await flush();

    expect(h.api.history.listUnified).not.toHaveBeenCalled();
  });

  it('a slow response for a closed dialog does not repopulate it', async () => {
    let release!: (v: unknown) => void;
    h.api.history.listUnified.mockImplementationOnce(() => new Promise((r) => { release = r; }));
    const store = getMultiFileHistoryStore();
    const opening = store.openFor(['notes/a.md'], []);
    store.close();
    release([{ ts: 1, origin: 'edit', path: 'notes/a.md', event: 'added' }]);
    await opening;
    await flush();

    expect(store.timeline).toEqual([]);
    expect(store.open).toBe(false);
  });

  it('close clears the timeline', async () => {
    h.api.history.listUnified.mockResolvedValue([{ ts: 1, origin: 'edit', path: 'notes/a.md', event: 'added' }]);
    const store = getMultiFileHistoryStore();
    await store.openFor(['notes/a.md'], []);
    expect(store.timeline).toHaveLength(1);

    store.close();
    expect(store.open).toBe(false);
    expect(store.timeline).toEqual([]);
  });

  it('surfaces a read failure instead of an empty timeline', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    h.api.history.listUnified.mockRejectedValue(new Error('broken index'));
    const store = getMultiFileHistoryStore();
    await store.openFor(['notes/a.md'], []);

    expect(store.error).toBe('broken index');
    expect(store.timeline).toEqual([]);
    err.mockRestore();
  });

  it('confirms before reverting, and reports a decline as null', async () => {
    const store = getMultiFileHistoryStore();
    await store.openFor(['notes/a.md'], []);
    h.showConfirm.mockResolvedValue(false);

    expect(await store.revert(123)).toBeNull();
    expect(h.api.history.batchRevert).not.toHaveBeenCalled();
  });

  it('reverts and re-loads the timeline on confirm', async () => {
    const store = getMultiFileHistoryStore();
    await store.openFor(['notes/a.md'], [{ relativePath: 'notes', isDirectory: true }]);
    h.showConfirm.mockResolvedValue(true);
    const outcome = {
      ts: 123, reverted: ['notes/a.md'], recreated: [], removed: [], unchanged: [], skipped: [], errors: [],
    };
    h.api.history.batchRevert.mockResolvedValue(outcome);
    h.api.history.listUnified.mockClear();

    expect(await store.revert(123)).toEqual(outcome);
    expect(h.api.history.batchRevert).toHaveBeenCalledWith(
      ['notes/a.md'],
      [{ relativePath: 'notes', isDirectory: true }],
      123,
    );
    expect(h.api.history.listUnified).toHaveBeenCalledTimes(1);
  });
});
