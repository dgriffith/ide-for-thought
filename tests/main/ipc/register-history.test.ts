/**
 * History IPC handlers (#1158). Drives the real `registerHistory()` with the
 * store + write-pipeline mocked, pinning: list/getRevision delegate to the
 * store, and restore reads the revision then writes it back through
 * `writeAndReindex` under the `restore` origin (with a cause naming the version
 * restored) — throwing (not silently) when the revision is gone.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const ROOT = '/vault';
/** What `rootPathFromEvent` reports — null models "Settings open, no project". */
let openProject: string | null = ROOT;
type Handler = (event: unknown, ...args: unknown[]) => unknown;

const { handlers, h } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  h: {
    listRevisions: vi.fn(),
    getRevisionContent: vi.fn(),
    runWithHistorySource: vi.fn(<T>(_s: unknown, fn: () => Promise<T>) => fn()),
    setRevisionLabel: vi.fn(),
    labelCurrentVersion: vi.fn(),
    getHistorySettings: vi.fn(),
    setHistorySettings: vi.fn(),
    pruneAllHistory: vi.fn(),
    writeAndReindex: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } },
}));
vi.mock('../../../src/main/ipc/helpers', () => ({
  withRootPath: <A extends unknown[], R>(fn: (rootPath: string, ...a: A) => R) =>
    (_e: unknown, ...args: A) => fn(ROOT, ...args),
  rootPathFromEvent: () => openProject,
  hooks: { HOOKS: true },
}));
vi.mock('../../../src/main/notebase/write-pipeline', () => ({ writeAndReindex: h.writeAndReindex }));
vi.mock('../../../src/main/history', () => ({
  listRevisions: h.listRevisions,
  getRevisionContent: h.getRevisionContent,
  runWithHistorySource: h.runWithHistorySource,
  setRevisionLabel: h.setRevisionLabel,
  labelCurrentVersion: h.labelCurrentVersion,
  getHistorySettings: h.getHistorySettings,
  setHistorySettings: h.setHistorySettings,
  pruneAllHistory: h.pruneAllHistory,
}));

import { registerHistory } from '../../../src/main/ipc/register-history';
import { Channels } from '../../../src/shared/channels';

registerHistory();
const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);

describe('register-history (#1158)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('HISTORY_LIST delegates to the store', async () => {
    h.listRevisions.mockResolvedValue([{ ts: 1, origin: 'edit' }]);
    await expect(call(Channels.HISTORY_LIST, 'notes/a.md')).resolves.toEqual([{ ts: 1, origin: 'edit' }]);
    expect(h.listRevisions).toHaveBeenCalledWith(ROOT, 'notes/a.md');
  });

  it('HISTORY_GET_REVISION delegates to the store', async () => {
    h.getRevisionContent.mockResolvedValue('old text');
    await expect(call(Channels.HISTORY_GET_REVISION, 'notes/a.md', 5)).resolves.toBe('old text');
    expect(h.getRevisionContent).toHaveBeenCalledWith(ROOT, 'notes/a.md', 5);
  });

  it('HISTORY_RESTORE writes the revision back through the pipeline under the restore origin', async () => {
    h.getRevisionContent.mockResolvedValue('restored body');
    await call(Channels.HISTORY_RESTORE, 'notes/a.md', 7);
    expect(h.runWithHistorySource).toHaveBeenCalledWith(
      // The cause names the version that came back, so a timeline with several
      // restores in it stays readable.
      { origin: 'restore', cause: expect.stringMatching(/^Restored from .+\d/) },
      expect.any(Function),
    );
    expect(h.writeAndReindex).toHaveBeenCalledWith(ROOT, 'notes/a.md', 'restored body', { HOOKS: true });
  });

  it('HISTORY_RESTORE throws when the revision is missing (no silent no-op)', async () => {
    h.getRevisionContent.mockResolvedValue(null);
    await expect(call(Channels.HISTORY_RESTORE, 'notes/a.md', 99)).rejects.toThrow(/not found/);
    expect(h.writeAndReindex).not.toHaveBeenCalled();
  });

  it('HISTORY_GET_SETTINGS reads the per-machine limits', async () => {
    const limits = { retentionDays: 7, maxRevisionsPerNote: 20, maxFileSizeKb: 512 };
    h.getHistorySettings.mockResolvedValue(limits);
    await expect(call(Channels.HISTORY_GET_SETTINGS)).resolves.toEqual(limits);
  });

  it('HISTORY_SET_SETTINGS saves, re-prunes the open project, and returns what was stored', async () => {
    const asked = { retentionDays: 0, maxRevisionsPerNote: 20, maxFileSizeKb: 512 };
    const stored = { retentionDays: 1, maxRevisionsPerNote: 20, maxFileSizeKb: 512 };
    h.setHistorySettings.mockResolvedValue(stored);
    h.pruneAllHistory.mockResolvedValue({ notes: 3, removed: 9 });

    // The CLAMPED values come back, so a settings box can't keep showing a
    // number that isn't what's in force.
    await expect(call(Channels.HISTORY_SET_SETTINGS, asked)).resolves.toEqual(stored);
    expect(h.setHistorySettings).toHaveBeenCalledWith(asked);
    // Lowering a limit frees disk now, not note-by-note on the next edit.
    expect(h.pruneAllHistory).toHaveBeenCalledWith(ROOT, expect.any(Number), stored);
  });

  it('HISTORY_SET_SETTINGS still saves with no project open (the limits are per-machine)', async () => {
    openProject = null;
    const stored = { retentionDays: 5, maxRevisionsPerNote: 20, maxFileSizeKb: 0 };
    h.setHistorySettings.mockResolvedValue(stored);
    try {
      await expect(call(Channels.HISTORY_SET_SETTINGS, stored)).resolves.toEqual(stored);
      expect(h.pruneAllHistory).not.toHaveBeenCalled();
    } finally {
      openProject = ROOT;
    }
  });

  it('HISTORY_SET_SETTINGS survives a failed prune — the save is what matters', async () => {
    const stored = { retentionDays: 5, maxRevisionsPerNote: 20, maxFileSizeKb: 0 };
    h.setHistorySettings.mockResolvedValue(stored);
    h.pruneAllHistory.mockRejectedValue(new Error('disk on fire'));
    await expect(call(Channels.HISTORY_SET_SETTINGS, stored)).resolves.toEqual(stored);
  });

  it('HISTORY_SET_LABEL names a revision, and clears it with null', async () => {
    await call(Channels.HISTORY_SET_LABEL, 'notes/a.md', 7, 'before refactor');
    expect(h.setRevisionLabel).toHaveBeenCalledWith(ROOT, 'notes/a.md', 7, 'before refactor');
    await call(Channels.HISTORY_SET_LABEL, 'notes/a.md', 7, null);
    expect(h.setRevisionLabel).toHaveBeenLastCalledWith(ROOT, 'notes/a.md', 7, undefined);
  });

  it('HISTORY_LABEL_NOTES labels every note and reports per-note failures without aborting', async () => {
    h.labelCurrentVersion
      .mockResolvedValueOnce({ ts: 1, origin: 'edit', label: 'v1' })
      .mockRejectedValueOnce(new Error('ENOENT'))
      .mockResolvedValueOnce({ ts: 2, origin: 'edit', label: 'v1' });

    const result = await call(Channels.HISTORY_LABEL_NOTES, ['a.md', 'gone.md', 'c.md'], 'v1');

    // The third note is still labeled — one bad note doesn't cost the user the
    // restore point on the rest.
    expect(result).toEqual({
      label: 'v1',
      labeled: ['a.md', 'c.md'],
      errors: [{ path: 'gone.md', error: 'ENOENT' }],
    });
  });
});
