/**
 * `register-maintenance.ts` handler coverage (#2233, epic #2241).
 *
 * These four operations used to run inline in `menu.ts` click handlers, which
 * is why they had no test: `ipc-registrar-coverage.test.ts` only knows about
 * `register-*.ts` files, and a command executed from a menu callback is not one.
 * Now that they are channels, they are covered by that ratchet — and by this.
 *
 * What's asserted here is the wiring, which is the thing that was missing: each
 * channel reaches its command with the focused project's rootPath, throws
 * rather than silently no-oping when no project is open (`withRootPath`, per
 * CLAUDE.md's IPC error-handling rule 2), and fans progress out to the windows
 * on that project. The commands' own behaviour is exercised where it lives —
 * `maintenance.test.ts` for the frame sequencing, and the graph/search/tables
 * suites for the indexing.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const { handlers, state, commands, broadcasts } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  state: { root: null as string | null },
  commands: {
    rebuildAllIndexes: vi.fn(),
    rebuildSemanticIndex: vi.fn(),
    interruptCell: vi.fn(),
    restartKernel: vi.fn(),
  },
  broadcasts: {
    maintenance: vi.fn(),
    backfill: vi.fn(),
  },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } },
}));

vi.mock('../../../src/main/ipc/helpers', () => ({
  withRootPath:
    <A extends unknown[], R>(fn: (rootPath: string, ...a: A) => R) =>
    (_e: unknown, ...args: A) => {
      if (!state.root) throw new Error('No project open');
      return fn(state.root, ...args);
    },
}));

vi.mock('../../../src/main/window-manager', () => ({
  broadcastMaintenanceProgress: (...a: unknown[]) => broadcasts.maintenance(...a),
  broadcastBackfillProgress: (...a: unknown[]) => broadcasts.backfill(...a),
}));

vi.mock('../../../src/main/maintenance-commands', () => commands);

import { registerMaintenance } from '../../../src/main/ipc/register-maintenance';
import { Channels } from '../../../src/shared/channels';

registerMaintenance();

const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);
/** Wrapped so a SYNCHRONOUS `withRootPath` throw is assertable with `rejects`
 *  the same way an async handler's rejection is. */
const callAsync = async (channel: string, ...args: unknown[]) => call(channel, ...args);

const ROOT = '/tmp/minerva-maintenance-test';

const ALL = [
  Channels.MAINTENANCE_REBUILD_INDEXES,
  Channels.MAINTENANCE_REBUILD_SEMANTIC_INDEX,
  Channels.MAINTENANCE_INTERRUPT_CELL,
  Channels.MAINTENANCE_RESTART_KERNEL,
] as const;

describe('register-maintenance.ts (#2233)', () => {
  beforeEach(() => {
    state.root = ROOT;
    for (const fn of Object.values(commands)) fn.mockReset().mockResolvedValue(undefined);
    for (const fn of Object.values(broadcasts)) fn.mockReset();
  });

  it('registers every maintenance channel', () => {
    for (const channel of ALL) expect(handlers.has(channel)).toBe(true);
  });

  it.each(ALL)('%s throws when no project is open, rather than no-oping', async (channel) => {
    // CLAUDE.md IPC rule 2: "no project open" is a failure, not a legitimate
    // empty answer. A rebuild that quietly did nothing would look identical to
    // one that succeeded.
    state.root = null;
    await expect(callAsync(channel)).rejects.toThrow(/No project open/);
  });

  it('rebuildIndexes passes the rootPath and hands back whether it finished', async () => {
    commands.rebuildAllIndexes.mockResolvedValue(true);
    await expect(callAsync(Channels.MAINTENANCE_REBUILD_INDEXES)).resolves.toBe(true);
    expect(commands.rebuildAllIndexes).toHaveBeenCalledWith(ROOT, expect.any(Function));
  });

  it('rebuildIndexes reports a failed rebuild as false, not as a rejection', async () => {
    // `runMaintenance` never throws — it emits a failure frame. The boolean is
    // what tells the caller not to refresh its panels off a half-built index.
    commands.rebuildAllIndexes.mockResolvedValue(false);
    await expect(callAsync(Channels.MAINTENANCE_REBUILD_INDEXES)).resolves.toBe(false);
  });

  it('rebuildSemanticIndex gets both emitters — maintenance frames AND backfill counts', async () => {
    await callAsync(Channels.MAINTENANCE_REBUILD_SEMANTIC_INDEX);
    expect(commands.rebuildSemanticIndex).toHaveBeenCalledWith(
      ROOT, expect.any(Function), expect.any(Function),
    );
  });

  it.each([
    [Channels.MAINTENANCE_INTERRUPT_CELL, 'interruptCell'],
    [Channels.MAINTENANCE_RESTART_KERNEL, 'restartKernel'],
  ] as const)('%s calls %s with the rootPath', async (channel, name) => {
    await callAsync(channel);
    expect(commands[name]).toHaveBeenCalledWith(ROOT, expect.any(Function));
  });

  it('the injected emitter broadcasts to the windows on that project', async () => {
    // The emitter is what makes these safe to trigger from either surface: a
    // run started from the renderer still reaches the native menu's progress
    // UI, and vice versa, because both fan out per-project rather than to the
    // window that happened to start it.
    await callAsync(Channels.MAINTENANCE_RESTART_KERNEL);
    const emit = commands.restartKernel.mock.calls[0]![1] as (p: unknown) => void;
    emit({ task: 'restartKernel', running: true, style: 'blocking', label: 'Restarting' });
    expect(broadcasts.maintenance).toHaveBeenCalledWith(
      ROOT, expect.objectContaining({ task: 'restartKernel' }),
    );
  });

  it('the semantic-index backfill emitter is the backfill broadcast, not the maintenance one', async () => {
    await callAsync(Channels.MAINTENANCE_REBUILD_SEMANTIC_INDEX);
    const emitBackfill = commands.rebuildSemanticIndex.mock.calls[0]![2] as (p: unknown) => void;
    emitBackfill({ done: 3, total: 10, running: true });
    expect(broadcasts.backfill).toHaveBeenCalledWith(ROOT, { done: 3, total: 10, running: true });
    expect(broadcasts.maintenance).not.toHaveBeenCalled();
  });
});
