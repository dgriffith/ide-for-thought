/**
 * `src/main/ipc/helpers.ts`, tested directly (#1926).
 *
 * This module owns the whole #1631 no-project convention — `withRootPath` vs
 * `withRootPathOr` vs `withRootPathWin` — which `vitest.config.mts` names as the
 * reason the `src/main/ipc/**` branch floor exists ("this layer owns the
 * `withRootPath` vs `withRootPathOr` decision, so a #1631 no-project conflation
 * now regresses into a test failure instead of passing in silence"). It also
 * owns `reindexFile`, the graph+search+vectors fan-out whose duplicated copies
 * caused the stale-embeddings drift in #1892.
 *
 * It had no test of its own. Sixteen registrar tests `vi.mock` it, so the glob
 * floor was satisfied by the registrars while the module implementing the policy
 * measured 6.55% statements / **0% branches**. One of those mocks
 * (`no-project-contract.test.ts`) re-implements the wrappers' semantics inside
 * the mock and asserts against the re-implementation — so a bug in the real
 * `rootPathFromEvent` → `winFromEvent` → `getRootPath(win.id)` chain was
 * invisible to every one of them.
 *
 * So: the real module, with only the process edges mocked (`electron`'s
 * `BrowserWindow`, `window-manager`'s window registry, and the three index
 * backends). `listIndexableFiles` runs against a real temp tree, because its
 * whole job is walking one.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

/** The project a window has open. `null` models "no project" / "Settings". */
let openProject: string | null = '/vault';

const { win, otherWin, registry, index } = vi.hoisted(() => {
  const mkWin = (id: number) => ({ id, webContents: { send: vi.fn() } });
  return {
    win: mkWin(1),
    otherWin: mkWin(2),
    /** What `windowsForProject` reports; a test sets it per case. */
    registry: { windows: [] as Array<{ id: number; webContents: { send: ReturnType<typeof vi.fn> } }> },
    index: {
      graphIndexNote: vi.fn(),
      graphRemoveNote: vi.fn(),
      searchIndexNote: vi.fn(),
      searchRemoveNote: vi.fn(),
      searchPersist: vi.fn(),
      vectorsIndexNote: vi.fn(),
      vectorsRemoveNote: vi.fn(),
      readFile: vi.fn(),
      markPathHandled: vi.fn(),
    },
  };
});

vi.mock('electron', () => ({
  // The real chain is `BrowserWindow.fromWebContents(e.sender)` — keyed off the
  // event so a test can hand in a window that isn't in the registry.
  BrowserWindow: { fromWebContents: (sender: unknown) => (sender as { win?: unknown })?.win ?? win },
  dialog: {},
}));

vi.mock('../../../src/main/window-manager', () => ({
  getRootPath: (id: number) => (id === win.id ? openProject : null),
  markPathHandled: index.markPathHandled,
  windowsForProject: () => registry.windows,
}));

vi.mock('../../../src/main/graph/index', () => ({
  indexNote: index.graphIndexNote,
  removeNote: index.graphRemoveNote,
}));
vi.mock('../../../src/main/search/index', () => ({
  indexNote: index.searchIndexNote,
  removeNote: index.searchRemoveNote,
  persist: index.searchPersist,
}));
vi.mock('../../../src/main/embeddings/vector-store', () => ({
  indexNote: index.vectorsIndexNote,
  removeNote: index.vectorsRemoveNote,
}));
vi.mock('../../../src/main/notebase/fs', () => ({ readFile: index.readFile }));

import {
  winFromEvent,
  rootPathFromEvent,
  withRootPath,
  withRootPathOr,
  withRootPathWin,
  reindexFile,
  removeFromIndexes,
  listIndexableFiles,
  persistIndexes,
  broadcastRewritten,
  broadcastHeadingRename,
  broadcastProposalsChanged,
  broadcastHistoryChanged,
  broadcastInspectionsChanged,
  hooks,
  readJsonFileOr,
} from '../../../src/main/ipc/helpers';
import { Channels } from '../../../src/shared/channels';

/** An IpcMainInvokeEvent, as far as these helpers are concerned. */
const evt = (w: unknown = win) => ({ sender: { win: w } }) as unknown as Electron.IpcMainInvokeEvent;

beforeEach(() => {
  vi.clearAllMocks();
  openProject = '/vault';
  registry.windows = [];
});

describe('winFromEvent / rootPathFromEvent', () => {
  it('resolves the window from the event sender', () => {
    expect(winFromEvent(evt())).toBe(win);
  });

  it('resolves the open project via the window id', () => {
    expect(rootPathFromEvent(evt())).toBe('/vault');
  });

  it('reports null for a window with no project open', () => {
    // A real second window (Settings, or a window whose project was released) —
    // not the same thing as `openProject = null`.
    expect(rootPathFromEvent(evt(otherWin))).toBeNull();
  });
});

describe('withRootPath — "there must be a project"', () => {
  it('hands the resolved rootPath to the handler, ahead of its own args', () => {
    const fn = vi.fn((root: string, a: string, b: number) => `${root}:${a}:${b}`);
    expect(withRootPath(fn)(evt(), 'x', 2)).toBe('/vault:x:2');
    expect(fn).toHaveBeenCalledWith('/vault', 'x', 2);
  });

  it('throws when no project is open, without calling the handler', () => {
    openProject = null;
    const fn = vi.fn();
    expect(() => withRootPath(fn)(evt())).toThrow('No project open');
    expect(fn).not.toHaveBeenCalled();
  });

  // The guard runs before the handler body, so a throw is synchronous even for
  // an async handler. `ipcMain.handle` turns that into a rejected renderer
  // promise either way — but the timing is what a caller sees under test.
  it('throws synchronously even when the handler is async', () => {
    openProject = null;
    expect(() => withRootPath(async () => 'never')(evt())).toThrow('No project open');
  });
});

describe('withRootPathOr — a legitimate project-less value', () => {
  it('runs the handler when a project is open', () => {
    const fn = vi.fn((root: string, n: number) => root.length + n);
    expect(withRootPathOr(-1, fn)(evt(), 1)).toBe(7);
  });

  it('returns the fallback, not the handler, when no project is open', () => {
    openProject = null;
    const fn = vi.fn();
    expect(withRootPathOr([], fn)(evt())).toEqual([]);
    expect(fn).not.toHaveBeenCalled();
  });

  it('returns the fallback synchronously — it does not wrap it in a promise', () => {
    openProject = null;
    // Callers written as `expect(...).resolves` would silently pass on any
    // value; the fallback arm never enters the async handler at all.
    expect(withRootPathOr(false, async () => true)(evt())).toBe(false);
  });

  it('hands back the caller\'s own fallback identity', () => {
    openProject = null;
    const sentinel = { ok: false as const };
    expect(withRootPathOr(sentinel, () => ({ ok: true as const }))(evt())).toBe(sentinel);
  });
});

describe('withRootPathWin — project + window', () => {
  it('hands the handler both the rootPath and the window', () => {
    const fn = vi.fn((root: string, w: unknown, a: string) => ({ root, w, a }));
    expect(withRootPathWin(fn)(evt(), 'arg')).toEqual({ root: '/vault', w: win, a: 'arg' });
  });

  it('throws when no project is open', () => {
    openProject = null;
    const fn = vi.fn();
    expect(() => withRootPathWin(fn)(evt())).toThrow('No project open');
    expect(fn).not.toHaveBeenCalled();
  });
});

describe('reindexFile — the graph/search/vectors fan-out', () => {
  it('sends a markdown note to all three indexes', async () => {
    index.readFile.mockResolvedValue('# hello');
    await reindexFile('/vault', 'notes/a.md');

    expect(index.readFile).toHaveBeenCalledWith('/vault', 'notes/a.md');
    expect(index.graphIndexNote).toHaveBeenCalledWith(expect.anything(), 'notes/a.md', '# hello');
    expect(index.searchIndexNote).toHaveBeenCalledWith(expect.anything(), 'notes/a.md', '# hello');
    expect(index.vectorsIndexNote).toHaveBeenCalledWith(expect.anything(), 'notes/a.md', '# hello');
  });

  // The asymmetry is deliberate — full-text and embeddings are markdown-only —
  // and it is the reason three hand-copied fan-outs drifted apart (#1892).
  it.each(['data/t.ttl', 'data/t.csv', 'scripts/t.py'])(
    'sends a non-markdown note (%s) to the graph only',
    async (rel) => {
      index.readFile.mockResolvedValue('content');
      await reindexFile('/vault', rel);

      expect(index.graphIndexNote).toHaveBeenCalled();
      expect(index.searchIndexNote).not.toHaveBeenCalled();
      expect(index.vectorsIndexNote).not.toHaveBeenCalled();
    },
  );

  it('skips a non-indexable file without even reading it', async () => {
    await reindexFile('/vault', 'assets/img.png');
    expect(index.readFile).not.toHaveBeenCalled();
    expect(index.graphIndexNote).not.toHaveBeenCalled();
  });

  // thoughtbase.md feeds the conversation system prompt, not the graph.
  it('skips the thoughtbase guide even though it is markdown', async () => {
    await reindexFile('/vault', 'thoughtbase.md');
    expect(index.readFile).not.toHaveBeenCalled();
    expect(index.graphIndexNote).not.toHaveBeenCalled();
  });
});

describe('removeFromIndexes — the mirror of the fan-out', () => {
  it('removes a markdown note from all three indexes', () => {
    removeFromIndexes('/vault', 'notes/a.md');
    expect(index.searchRemoveNote).toHaveBeenCalledWith(expect.anything(), 'notes/a.md');
    expect(index.graphRemoveNote).toHaveBeenCalledWith(expect.anything(), 'notes/a.md');
    expect(index.vectorsRemoveNote).toHaveBeenCalledWith(expect.anything(), 'notes/a.md');
  });

  // Note the shape difference from reindexFile: removal is unconditional across
  // all three, because removing a key that was never indexed is a no-op.
  it('removes a non-markdown note from all three as well', () => {
    removeFromIndexes('/vault', 'data/t.ttl');
    expect(index.graphRemoveNote).toHaveBeenCalled();
    expect(index.searchRemoveNote).toHaveBeenCalled();
    expect(index.vectorsRemoveNote).toHaveBeenCalled();
  });

  it('skips a non-indexable file', () => {
    removeFromIndexes('/vault', 'assets/img.png');
    expect(index.graphRemoveNote).not.toHaveBeenCalled();
  });
});

describe('listIndexableFiles — walks a real tree', () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-ipc-helpers-'));
    fs.mkdirSync(path.join(root, 'notes', 'deep'), { recursive: true });
    fs.mkdirSync(path.join(root, '.hidden'), { recursive: true });
    fs.writeFileSync(path.join(root, 'notes', 'a.md'), '');
    fs.writeFileSync(path.join(root, 'notes', 'data.csv'), '');
    fs.writeFileSync(path.join(root, 'notes', 'img.png'), '');
    fs.writeFileSync(path.join(root, 'notes', '.secret.md'), '');
    fs.writeFileSync(path.join(root, 'notes', 'deep', 'b.md'), '');
    fs.writeFileSync(path.join(root, '.hidden', 'c.md'), '');
  });

  afterEach(async () => {
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('recurses, keeps indexable files, and drops the rest', async () => {
    expect((await listIndexableFiles(root, 'notes')).sort()).toEqual([
      'notes/a.md',
      'notes/data.csv',
      'notes/deep/b.md',
    ]);
  });

  it('skips dotted entries at every level', async () => {
    const all = await listIndexableFiles(root, '');
    expect(all).not.toContain('.hidden/c.md');
    expect(all).toContain('notes/a.md');
  });

  it('joins paths without a leading slash when relDir is empty', async () => {
    expect(await listIndexableFiles(root, '')).toContain('notes/a.md');
  });

  // The `catch` exists so a caller can ask about a directory that was just
  // deleted; an empty list is the honest answer, not a crash.
  it('returns an empty list for a directory that does not exist', async () => {
    await expect(listIndexableFiles(root, 'nope/not/here')).resolves.toEqual([]);
  });
});

describe('persistIndexes', () => {
  // graph.ttl is a cold snapshot (#348) — it flushes on project release, not here.
  it('persists the search index only', async () => {
    await persistIndexes('/vault');
    expect(index.searchPersist).toHaveBeenCalledTimes(1);
  });
});

describe('broadcasts — fan out to every window on the project', () => {
  beforeEach(() => { registry.windows = [win, otherWin]; });

  it('broadcastRewritten reaches both windows', () => {
    broadcastRewritten('/vault', ['notes/a.md']);
    for (const w of [win, otherWin]) {
      expect(w.webContents.send).toHaveBeenCalledWith(Channels.NOTEBASE_REWRITTEN, ['notes/a.md']);
    }
  });

  it('broadcastRewritten sends nothing for an empty path list', () => {
    broadcastRewritten('/vault', []);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('broadcastHeadingRename carries the candidate', () => {
    const candidate = { relativePath: 'notes/a.md', from: 'Old', to: 'New' };
    broadcastHeadingRename('/vault', candidate as never);
    expect(win.webContents.send)
      .toHaveBeenCalledWith(Channels.NOTEBASE_HEADING_RENAME_SUGGESTED, candidate);
  });

  it('broadcastProposalsChanged is a bare signal', () => {
    broadcastProposalsChanged('/vault');
    expect(win.webContents.send).toHaveBeenCalledWith(Channels.PROPOSALS_CHANGED);
  });

  it('broadcastHistoryChanged carries the note path', () => {
    broadcastHistoryChanged('/vault', 'notes/a.md');
    expect(win.webContents.send).toHaveBeenCalledWith(Channels.HISTORY_CHANGED, 'notes/a.md');
  });

  it('broadcastHistoryChanged carries null for a project-wide change', () => {
    broadcastHistoryChanged('/vault', null);
    expect(win.webContents.send).toHaveBeenCalledWith(Channels.HISTORY_CHANGED, null);
  });

  it('broadcastInspectionsChanged is a bare signal', () => {
    broadcastInspectionsChanged('/vault');
    expect(win.webContents.send).toHaveBeenCalledWith(Channels.INSPECTIONS_CHANGED);
  });

  it('a project with no open windows is a silent no-op, not a crash', () => {
    registry.windows = [];
    expect(() => {
      broadcastRewritten('/vault', ['notes/a.md']);
      broadcastProposalsChanged('/vault');
      broadcastInspectionsChanged('/vault');
    }).not.toThrow();
  });
});

describe('the write-pipeline hooks bundle', () => {
  it('exposes the real broadcast + markPathHandled implementations', () => {
    expect(hooks.markPathHandled).toBe(index.markPathHandled);
    expect(hooks.broadcastRewritten).toBe(broadcastRewritten);
    expect(hooks.broadcastHeadingRename).toBe(broadcastHeadingRename);
  });
});

describe('readJsonFileOr re-export', () => {
  // Re-exported through the helpers barrel so callers (and CLAUDE.md's IPC
  // section) can reach it here; the implementation is a leaf module.
  it('is the read-json leaf, reachable from the barrel', async () => {
    const leaf = await import('../../../src/main/ipc/read-json');
    expect(readJsonFileOr).toBe(leaf.readJsonFileOr);
  });
});
