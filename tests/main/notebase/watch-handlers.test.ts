/**
 * `createWatchHandlers()` (#1907, extracted out of `window-manager.ts`'s
 * ~270-line `openProjectInWindow`). All downstream modules are mocked, the
 * same shape as the sibling `index-fanout.test.ts` — no `BrowserWindow` is
 * constructed anywhere here; `broadcastIfAlive` is a plain function, which is
 * the whole point of the extraction (#1892's stale-vector bug was hard to
 * regression-test while these handlers only existed as closures inline in
 * `startWatching(rootPath, win, win.id, { ... })`).
 *
 * `onFileChanged` / `onFileCreated` share their `upsert` tail (#1907) — the
 * parametrized describe block below runs the same scenarios against both to
 * prove that sharing didn't silently drop either one's behavior.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  wasHandled: vi.fn().mockReturnValue(false),
  readFile: vi.fn().mockResolvedValue('# content'),
  indexAllFor: vi.fn().mockResolvedValue(undefined),
  removeAllFor: vi.fn(),
  registerCsv: vi.fn().mockResolvedValue(undefined),
  unregisterCsv: vi.fn().mockResolvedValue(undefined),
  reregisterNoteTables: vi.fn().mockResolvedValue({ changed: false }),
  unregisterNoteTables: vi.fn().mockResolvedValue(undefined),
  invalidatePythonModules: vi.fn(),
  searchPersist: vi.fn().mockResolvedValue(undefined),
  graphIndexSource: vi.fn(),
  graphRemoveSource: vi.fn(),
  graphIndexExcerpt: vi.fn(),
  graphRemoveExcerpt: vi.fn(),
  vectorsIndexSource: vi.fn().mockResolvedValue(undefined),
  vectorsRemoveSource: vi.fn().mockResolvedValue(undefined),
  vectorsIndexExcerpt: vi.fn().mockResolvedValue(undefined),
  vectorsRemoveExcerpt: vi.fn().mockResolvedValue(undefined),
  citedTextFromTtl: vi.fn().mockReturnValue('cited text'),
}));

vi.mock('../../../src/main/notebase/path-dedup', () => ({ wasHandled: h.wasHandled }));
vi.mock('../../../src/main/notebase/fs', () => ({ readFile: h.readFile }));
vi.mock('../../../src/main/notebase/index-fanout', () => ({
  indexAllFor: h.indexAllFor,
  removeAllFor: h.removeAllFor,
}));
vi.mock('../../../src/main/sources/tables', () => ({
  registerCsv: h.registerCsv,
  unregisterCsv: h.unregisterCsv,
  reregisterNoteTables: h.reregisterNoteTables,
  unregisterNoteTables: h.unregisterNoteTables,
}));
vi.mock('../../../src/main/compute/python-kernel', () => ({ invalidate: h.invalidatePythonModules }));
vi.mock('../../../src/main/search/index', () => ({ persist: h.searchPersist }));
vi.mock('../../../src/main/graph/index', () => ({
  indexSource: h.graphIndexSource,
  removeSource: h.graphRemoveSource,
  indexExcerpt: h.graphIndexExcerpt,
  removeExcerpt: h.graphRemoveExcerpt,
}));
vi.mock('../../../src/main/embeddings/vector-store', () => ({
  indexSource: h.vectorsIndexSource,
  removeSource: h.vectorsRemoveSource,
  indexExcerpt: h.vectorsIndexExcerpt,
  removeExcerpt: h.vectorsRemoveExcerpt,
}));
vi.mock('../../../src/main/sources/create-excerpt', () => ({ citedTextFromTtl: h.citedTextFromTtl }));

import { createWatchHandlers, type WatchHandlerDeps } from '../../../src/main/notebase/watch-handlers';
import { Channels } from '../../../src/shared/channels';
import type { ProjectContext } from '../../../src/main/project-context-types';

const CTX = { rootPath: '/vault', _brand: 'ProjectContext' as const } as unknown as ProjectContext;

function makeHandlers(overrides: Partial<WatchHandlerDeps> = {}) {
  const broadcastIfAlive = vi.fn();
  const handlers = createWatchHandlers({
    rootPath: '/vault',
    projectCtx: CTX,
    broadcastIfAlive,
    ...overrides,
  });
  return { handlers, broadcastIfAlive };
}

beforeEach(() => {
  vi.clearAllMocks();
  h.wasHandled.mockReturnValue(false);
  h.readFile.mockResolvedValue('# content');
  h.reregisterNoteTables.mockResolvedValue({ changed: false });
});

describe.each([
  ['onFileChanged', (handlers: ReturnType<typeof createWatchHandlers>) => handlers.onFileChanged] as const,
  ['onFileCreated', (handlers: ReturnType<typeof createWatchHandlers>) => handlers.onFileCreated] as const,
])('%s (shared upsert, #1907)', (_name, pick) => {
  it('does nothing when the path was already handled by an IPC write', async () => {
    h.wasHandled.mockReturnValue(true);
    const { handlers } = makeHandlers();
    await pick(handlers)('notes/a.md');
    expect(h.indexAllFor).not.toHaveBeenCalled();
    expect(h.registerCsv).not.toHaveBeenCalled();
  });

  it('indexes a markdown note and persists', async () => {
    const { handlers } = makeHandlers();
    await pick(handlers)('notes/a.md');
    expect(h.readFile).toHaveBeenCalledWith('/vault', 'notes/a.md');
    expect(h.indexAllFor).toHaveBeenCalledWith(CTX, 'notes/a.md', '# content');
    expect(h.reregisterNoteTables).toHaveBeenCalledWith(CTX, 'notes/a.md', '# content');
  });

  it('broadcasts TABLES_CHANGED when a markdown note\'s captioned table changed', async () => {
    h.reregisterNoteTables.mockResolvedValue({ changed: true });
    const { handlers, broadcastIfAlive } = makeHandlers();
    await pick(handlers)('notes/a.md');
    expect(broadcastIfAlive).toHaveBeenCalledWith(Channels.TABLES_CHANGED);
  });

  it('registers a .csv file with DuckDB independently of the graph pass', async () => {
    const { handlers, broadcastIfAlive } = makeHandlers();
    await pick(handlers)('data/t.csv');
    expect(h.registerCsv).toHaveBeenCalledWith(CTX, 'data/t.csv');
    expect(broadcastIfAlive).toHaveBeenCalledWith(Channels.TABLES_CHANGED);
    // Still proceeds to the graph/search/vectors pass — CSVs are indexable notes.
    expect(h.indexAllFor).toHaveBeenCalledWith(CTX, 'data/t.csv', '# content');
  });

  it('re-registers a sibling CSV when its schema sidecar changes, and skips the graph pass', async () => {
    const { handlers } = makeHandlers();
    await pick(handlers)('data/t.csv.schema.yaml');
    // The schema-sidecar shape resolves the sibling by string-slice, not a
    // disk probe (unlike the .md-companion shape below) — the .csv is
    // presumed to exist since its own schema file is what's changing.
    expect(h.registerCsv).toHaveBeenCalledWith(CTX, 'data/t.csv');
    // The sidecar itself is not a note — no readFile/indexAllFor for it.
    expect(h.readFile).not.toHaveBeenCalled();
    expect(h.indexAllFor).not.toHaveBeenCalled();
  });

  it('queues a Python kernel invalidate for a .py file', async () => {
    vi.useFakeTimers();
    try {
      const { handlers } = makeHandlers();
      await pick(handlers)('scripts/a.py');
      expect(h.invalidatePythonModules).not.toHaveBeenCalled(); // debounced
      await vi.advanceTimersByTimeAsync(300);
      expect(h.invalidatePythonModules).toHaveBeenCalledWith('/vault', ['scripts/a.py']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('logs and swallows a read failure instead of throwing (common race: file deleted mid-event)', async () => {
    h.readFile.mockRejectedValue(new Error('ENOENT'));
    const { handlers } = makeHandlers();
    await expect(pick(handlers)('notes/a.md')).resolves.toBeUndefined();
  });
});

describe('onFileDeleted', () => {
  it('does nothing when the path was already handled by an IPC write', async () => {
    h.wasHandled.mockReturnValue(true);
    const { handlers } = makeHandlers();
    await handlers.onFileDeleted('notes/a.md');
    expect(h.removeAllFor).not.toHaveBeenCalled();
  });

  it('removes a markdown note and its owned tables', async () => {
    const { handlers, broadcastIfAlive } = makeHandlers();
    await handlers.onFileDeleted('notes/a.md');
    expect(h.removeAllFor).toHaveBeenCalledWith(CTX, 'notes/a.md');
    expect(h.unregisterNoteTables).toHaveBeenCalledWith(CTX, 'notes/a.md');
    expect(broadcastIfAlive).toHaveBeenCalledWith(Channels.TABLES_CHANGED);
  });

  it('unregisters a deleted .csv from DuckDB', async () => {
    const { handlers, broadcastIfAlive } = makeHandlers();
    await handlers.onFileDeleted('data/t.csv');
    expect(h.unregisterCsv).toHaveBeenCalledWith(CTX, 'data/t.csv');
    expect(broadcastIfAlive).toHaveBeenCalledWith(Channels.TABLES_CHANGED);
    expect(h.removeAllFor).toHaveBeenCalledWith(CTX, 'data/t.csv');
  });

  it('re-registers the sibling CSV (schema reverts) and skips removeAllFor for a schema sidecar', async () => {
    const { handlers } = makeHandlers();
    await handlers.onFileDeleted('data/t.csv.schema.yaml');
    expect(h.registerCsv).toHaveBeenCalledWith(CTX, 'data/t.csv');
    expect(h.removeAllFor).not.toHaveBeenCalled();
  });
});

describe('source/excerpt watch handlers', () => {
  it('onSourceMetaChanged indexes the source into graph + vectors and broadcasts', async () => {
    h.readFile.mockImplementation((_root: string, rel: string) =>
      rel.endsWith('meta.ttl') ? Promise.resolve('meta ttl') : Promise.reject(new Error('no body')));
    const { handlers, broadcastIfAlive } = makeHandlers();
    await handlers.onSourceMetaChanged!('smith-2023');
    expect(h.graphIndexSource).toHaveBeenCalledWith(CTX, 'smith-2023', 'meta ttl', undefined);
    expect(h.vectorsIndexSource).toHaveBeenCalledWith(CTX, 'smith-2023', '');
    expect(broadcastIfAlive).toHaveBeenCalledWith(Channels.SOURCES_CHANGED);
  });

  it('onSourceMetaChanged silently no-ops when meta.ttl is gone (race with deletion)', async () => {
    h.readFile.mockRejectedValue(new Error('ENOENT'));
    const { handlers, broadcastIfAlive } = makeHandlers();
    await expect(handlers.onSourceMetaChanged!('gone')).resolves.toBeUndefined();
    expect(h.graphIndexSource).not.toHaveBeenCalled();
    expect(broadcastIfAlive).not.toHaveBeenCalled();
  });

  it('onSourceMetaDeleted removes the source from graph + vectors and broadcasts', () => {
    const { handlers, broadcastIfAlive } = makeHandlers();
    handlers.onSourceMetaDeleted!('smith-2023');
    expect(h.graphRemoveSource).toHaveBeenCalledWith(CTX, 'smith-2023');
    expect(h.vectorsRemoveSource).toHaveBeenCalledWith(CTX, 'smith-2023');
    expect(broadcastIfAlive).toHaveBeenCalledWith(Channels.SOURCES_CHANGED);
  });

  it('onExcerptChanged indexes the excerpt into graph + vectors (cited text) and broadcasts', async () => {
    const { handlers, broadcastIfAlive } = makeHandlers();
    await handlers.onExcerptChanged!('p42-graphs');
    expect(h.graphIndexExcerpt).toHaveBeenCalledWith(CTX, 'p42-graphs', '# content');
    expect(h.citedTextFromTtl).toHaveBeenCalledWith('# content');
    expect(h.vectorsIndexExcerpt).toHaveBeenCalledWith(CTX, 'p42-graphs', 'cited text');
    expect(broadcastIfAlive).toHaveBeenCalledWith(Channels.EXCERPTS_CHANGED);
  });

  it('onExcerptDeleted removes the excerpt from graph + vectors and broadcasts', () => {
    const { handlers, broadcastIfAlive } = makeHandlers();
    handlers.onExcerptDeleted!('p42-graphs');
    expect(h.graphRemoveExcerpt).toHaveBeenCalledWith(CTX, 'p42-graphs');
    expect(h.vectorsRemoveExcerpt).toHaveBeenCalledWith(CTX, 'p42-graphs');
    expect(broadcastIfAlive).toHaveBeenCalledWith(Channels.EXCERPTS_CHANGED);
  });
});

describe('broadcastIfAlive abstraction (#1907)', () => {
  it('never constructs a BrowserWindow — the deps object is a plain function', async () => {
    const calls: string[] = [];
    const { handlers } = makeHandlers({ broadcastIfAlive: (channel) => { calls.push(channel); } });
    await handlers.onFileChanged('data/t.csv');
    expect(calls).toContain(Channels.TABLES_CHANGED);
  });
});
