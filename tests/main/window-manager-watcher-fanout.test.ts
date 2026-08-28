/**
 * The watcher-driven note fan-out in `window-manager.ts` (#1892).
 *
 * `onFileChanged` / `onFileCreated` / `onFileDeleted` used to hand-roll their
 * own graph+search(+vectors) calls, and the hand-rolled copies never called
 * into the vector store — so a note edited on disk (the watcher path, as
 * opposed to an IPC-driven save) kept a stale embedding forever (nothing else
 * ever re-checks a note that's already been embedded once). This drives the
 * real `openProjectInWindow`, captures the `WatcherCallbacks` object handed to
 * `startWatching`, and invokes those callbacks directly to prove the watcher
 * now goes through the shared `indexAllFor`/`removeAllFor` fan-out
 * (`notebase/index-fanout.ts`) instead of its own copy.
 *
 * Everything `openProjectInWindow` touches outside that fan-out — electron,
 * project acquisition, tables, templates, the python kernel, sessions,
 * backfill, the clipper lifecycle — is mocked to a no-op; only
 * `notebase/index-fanout` runs for real, so this test actually exercises the
 * wiring rather than re-asserting the fan-out's own unit tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { WatcherCallbacks } from '../../src/main/notebase/watcher';

const h = vi.hoisted(() => ({
  watcherCallbacks: undefined as WatcherCallbacks | undefined,
  fileContents: new Map<string, string>(),
  graphIndexNote: vi.fn().mockResolvedValue({}),
  graphRemoveNote: vi.fn(),
  searchIndexNote: vi.fn(),
  searchRemoveNote: vi.fn(),
  vectorsIndexNote: vi.fn().mockResolvedValue(undefined),
  vectorsRemoveNote: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('electron', () => ({
  BrowserWindow: { getAllWindows: () => [], fromId: () => null, getFocusedWindow: () => null },
  app: {},
  session: {},
  shell: {},
}));

vi.mock('../../src/main/ipc/broadcast', () => ({ broadcast: vi.fn() }));
vi.mock('../../src/main/project-config', () => ({ resolveDisplayName: () => 'Test Project' }));
vi.mock('../../src/main/notebase/watcher', () => ({
  startWatching: vi.fn((_rootPath: string, _win: unknown, _id: number, callbacks: WatcherCallbacks) => {
    h.watcherCallbacks = callbacks;
    return Promise.resolve();
  }),
  stopWatching: vi.fn(),
}));
vi.mock('../../src/main/notebase/path-dedup', () => ({
  markPathHandled: vi.fn(),
  wasHandled: () => false,
}));
vi.mock('../../src/main/graph/index', () => ({
  indexNote: h.graphIndexNote,
  removeNote: h.graphRemoveNote,
}));
vi.mock('../../src/main/search/index', () => ({
  indexNote: h.searchIndexNote,
  removeNote: h.searchRemoveNote,
  persist: vi.fn(),
}));
vi.mock('../../src/main/embeddings/vector-store', () => ({
  indexNote: h.vectorsIndexNote,
  removeNote: h.vectorsRemoveNote,
  indexSource: vi.fn(),
  removeSource: vi.fn(),
  indexExcerpt: vi.fn(),
  removeExcerpt: vi.fn(),
}));
vi.mock('../../src/main/notebase/fs', () => ({
  readFile: vi.fn((_rootPath: string, relativePath: string) => {
    const content = h.fileContents.get(relativePath);
    if (content === undefined) return Promise.reject(new Error(`no fixture for ${relativePath}`));
    return Promise.resolve(content);
  }),
}));
vi.mock('../../src/main/notebase/templates', () => ({ ensureSeeded: vi.fn().mockResolvedValue(undefined) }));
vi.mock('../../src/main/sources/tables', () => ({
  onCsvTableCollision: () => () => {},
  registerCsv: vi.fn().mockResolvedValue(undefined),
  unregisterCsv: vi.fn().mockResolvedValue(undefined),
  reregisterNoteTables: vi.fn().mockResolvedValue({ changed: false }),
  unregisterNoteTables: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/main/compute/python-kernel', () => ({ invalidate: vi.fn() }));
vi.mock('../../src/main/recent-projects', () => ({ addRecentProject: vi.fn() }));
vi.mock('../../src/main/session', () => ({ saveSession: vi.fn() }));
vi.mock('../../src/main/project-context', () => ({
  acquireProject: vi.fn((rootPath: string) => Promise.resolve({ rootPath, _brand: 'ProjectContext' })),
  releaseProject: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../src/main/embeddings/backfill', () => ({ runBackfill: vi.fn() }));
vi.mock('../../src/main/sources/create-excerpt', () => ({ citedTextFromTtl: () => '' }));
vi.mock('../../src/main/clipper/lifecycle', () => ({
  ensureClipperRunning: vi.fn().mockResolvedValue(undefined),
  stopClipperServer: vi.fn().mockResolvedValue(undefined),
  isClipperEnabled: vi.fn().mockResolvedValue(false),
}));

import { openProjectInWindow } from '../../src/main/window-manager';

function fakeWindow(id: number) {
  return {
    id,
    isDestroyed: () => false,
    once: () => {},
    webContents: { send: vi.fn() },
  } as unknown as Electron.BrowserWindow;
}

beforeEach(async () => {
  vi.clearAllMocks();
  h.watcherCallbacks = undefined;
  h.fileContents.clear();
  await openProjectInWindow(fakeWindow(1), '/vault');
});

describe('watcher onFileChanged / onFileCreated fan-out (#1892)', () => {
  it.each(['onFileChanged', 'onFileCreated'] as const)(
    '%s sends a markdown note to graph, search, AND the vector store',
    async (event) => {
      h.fileContents.set('notes/a.md', '# hello');
      await h.watcherCallbacks![event]('notes/a.md');

      expect(h.graphIndexNote).toHaveBeenCalledWith(expect.anything(), 'notes/a.md', '# hello');
      expect(h.searchIndexNote).toHaveBeenCalledWith(expect.anything(), 'notes/a.md', '# hello');
      expect(h.vectorsIndexNote).toHaveBeenCalledWith(expect.anything(), 'notes/a.md', '# hello');
    },
  );

  it.each(['onFileChanged', 'onFileCreated'] as const)(
    '%s sends a non-markdown note (.ttl) to the graph only',
    async (event) => {
      h.fileContents.set('data/t.ttl', 'content');
      await h.watcherCallbacks![event]('data/t.ttl');

      expect(h.graphIndexNote).toHaveBeenCalled();
      expect(h.searchIndexNote).not.toHaveBeenCalled();
      expect(h.vectorsIndexNote).not.toHaveBeenCalled();
    },
  );
});

describe('watcher onFileDeleted fan-out (#1892)', () => {
  it('removes a note from graph, search, AND the vector store', async () => {
    await h.watcherCallbacks!.onFileDeleted('notes/a.md');

    expect(h.graphRemoveNote).toHaveBeenCalledWith(expect.anything(), 'notes/a.md');
    expect(h.searchRemoveNote).toHaveBeenCalledWith(expect.anything(), 'notes/a.md');
    expect(h.vectorsRemoveNote).toHaveBeenCalledWith(expect.anything(), 'notes/a.md');
  });
});
