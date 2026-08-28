/**
 * BOOKMARKS_LOAD / TABS_LOAD store-load behaviour (#1631). Drives the real
 * `registerBookmarks()` handlers against a temp project root, with the REAL
 * `readJsonFileOr` leaf wired in (only electron + the project-scoping helpers
 * are mocked). Pins that a corrupt store now rejects instead of silently
 * reading back as "no bookmarks" / "fresh session" — the swallow the old
 * `catch { return [] | null }` hid.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const { handlers, state } = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  state: { root: null as string | null },
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } },
}));

// Keep the REAL readJsonFileOr (the code under test); only stub the
// project-scoping wrappers so we can steer/clear the root.
vi.mock('../../../src/main/ipc/helpers', async () => {
  const { readJsonFileOr } = await import('../../../src/main/ipc/read-json');
  return {
    readJsonFileOr,
    rootPathFromEvent: () => state.root,
    withRootPath:
      <A extends unknown[], R>(fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A) => {
        if (!state.root) throw new Error('No project open');
        return fn(state.root, ...args);
      },
    withRootPathOr:
      <A extends unknown[], R>(fallback: R, fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A) => (state.root ? fn(state.root, ...args) : fallback),
  };
});

import { registerBookmarks } from '../../../src/main/ipc/register-bookmarks';
import { Channels } from '../../../src/shared/channels';

registerBookmarks();

const call = (channel: string, ...args: unknown[]) => handlers.get(channel)!({}, ...args);

describe('register-bookmarks store loads (#1631)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-bm-'));
    await fs.mkdir(path.join(dir, '.minerva'), { recursive: true });
    state.root = dir;
  });
  afterEach(async () => {
    state.root = null;
    await fs.rm(dir, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('BOOKMARKS_LOAD returns [] when the file is absent', async () => {
    await expect(call(Channels.BOOKMARKS_LOAD)).resolves.toEqual([]);
  });

  it('BOOKMARKS_LOAD parses a valid bookmarks.json', async () => {
    const tree = [{ id: 'a', label: 'A', kind: 'note', path: 'a.md' }];
    await fs.writeFile(path.join(dir, '.minerva', 'bookmarks.json'), JSON.stringify(tree), 'utf-8');
    await expect(call(Channels.BOOKMARKS_LOAD)).resolves.toEqual(tree);
  });

  it('BOOKMARKS_LOAD REJECTS on a corrupt bookmarks.json (no silent data loss)', async () => {
    await fs.writeFile(path.join(dir, '.minerva', 'bookmarks.json'), '{ corrupt', 'utf-8');
    await expect(call(Channels.BOOKMARKS_LOAD)).rejects.toThrow();
  });

  it('TABS_LOAD returns null with no project open, and when tabs.json is absent', async () => {
    await expect(call(Channels.TABS_LOAD)).resolves.toBeNull();
    state.root = null;
    await expect(call(Channels.TABS_LOAD)).resolves.toBeNull();
  });

  it('TABS_LOAD REJECTS on a corrupt tabs.json instead of collapsing to null', async () => {
    await fs.writeFile(path.join(dir, '.minerva', 'tabs.json'), 'not json at all', 'utf-8');
    await expect(call(Channels.TABS_LOAD)).rejects.toThrow();
  });

  // #1894 — these two used to be `withRootPathOr(undefined, …)`, so saving with
  // no project open silently resolved as if the write had happened.
  it('BOOKMARKS_SAVE throws with no project rather than silently doing nothing', () => {
    state.root = null;
    expect(() => call(Channels.BOOKMARKS_SAVE, [])).toThrow('No project open');
  });

  it('TABS_SAVE throws with no project rather than silently doing nothing', () => {
    state.root = null;
    expect(() => call(Channels.TABS_SAVE, {})).toThrow('No project open');
  });
});
