/**
 * History IPC handlers (#1158). Drives the real `registerHistory()` with the
 * store + write-pipeline mocked, pinning: list/getRevision delegate to the
 * store, and restore reads the revision then writes it back through
 * `writeAndReindex` under the `restore` origin — throwing (not silently) when
 * the revision is gone.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

const ROOT = '/vault';
type Handler = (event: unknown, ...args: unknown[]) => unknown;

const { handlers, h } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  h: {
    listRevisions: vi.fn(),
    getRevisionContent: vi.fn(),
    runWithHistoryOrigin: vi.fn(<T>(_o: string, fn: () => Promise<T>) => fn()),
    writeAndReindex: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } },
}));
vi.mock('../../../src/main/ipc/helpers', () => ({
  withRootPath: <A extends unknown[], R>(fn: (rootPath: string, ...a: A) => R) =>
    (_e: unknown, ...args: A) => fn(ROOT, ...args),
  hooks: { HOOKS: true },
}));
vi.mock('../../../src/main/notebase/write-pipeline', () => ({ writeAndReindex: h.writeAndReindex }));
vi.mock('../../../src/main/history', () => ({
  listRevisions: h.listRevisions,
  getRevisionContent: h.getRevisionContent,
  runWithHistoryOrigin: h.runWithHistoryOrigin,
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
    expect(h.runWithHistoryOrigin).toHaveBeenCalledWith('restore', expect.any(Function));
    expect(h.writeAndReindex).toHaveBeenCalledWith(ROOT, 'notes/a.md', 'restored body', { HOOKS: true });
  });

  it('HISTORY_RESTORE throws when the revision is missing (no silent no-op)', async () => {
    h.getRevisionContent.mockResolvedValue(null);
    await expect(call(Channels.HISTORY_RESTORE, 'notes/a.md', 99)).rejects.toThrow(/not found/);
    expect(h.writeAndReindex).not.toHaveBeenCalled();
  });
});
