/**
 * @vitest-environment node
 *
 * Main-process coverage for `register-sources.ts` (#1840, fan-out fixed #1916).
 *
 * At 343 lines this was the largest remaining untested registrar, and the one
 * with the most repetition: a dozen source mutations that all have to
 * `persistIndexes` and then announce the change. Copy-paste is exactly where
 * one of those steps goes missing, so the repeated contract is asserted for
 * every handler via a table rather than trusted to review.
 *
 * Beyond that it pins the parts with real logic:
 *
 *   - the #1631 project guard on every handler — throw vs each fallback's own
 *     legitimate empty value;
 *   - every mutation announces itself via `broadcastSourcesChanged` /
 *     `broadcastExcerptsChanged` / `broadcastCollectionsChanged` (#1916) —
 *     ONE per rootPath, fanned out to every window on the project, not just
 *     the invoking one. The fan-out mechanism itself (multiple windows, a
 *     destroyed one excluded) is `helpers.ts`'s job and is pinned in
 *     `helpers.test.ts`; what matters here is that each handler calls the
 *     right broadcast function, with the right rootPath, after the mutation
 *     lands — not before, and not on failure;
 *   - `SOURCES_MERGE` carries a `MergeSourcesError`'s structured `code` across
 *     the IPC boundary (a plain rethrow loses it and the UI can no longer tell
 *     "you picked the same source twice" from a crash) while any other error
 *     passes through untouched;
 *   - ingest fetches through the privileged-sites wrapper, not bare `fetch`,
 *     and honours the user's `importUpstreamTags` setting;
 *   - a cancelled file picker imports nothing;
 *   - the reading-queue / smart-collection membership filters short-circuit
 *     instead of listing every source in the thoughtbase to intersect against
 *     an empty set.
 *
 * The BibTeX/Zotero import progress channels are unrelated to #1916 — they're
 * per-operation progress for the window that opened the file picker, not a
 * "something changed" signal other windows need, so they still target `win`
 * directly and still check `isDestroyed()` themselves.
 *
 * `withRootPath*` are re-implemented in the helpers mock with the real
 * semantics (helpers.ts drags in electron + graph/search/vectors, so it can't
 * be imported here). Their own contract is covered by
 * tests/main/ipc/registration.test.ts; what matters here is WHICH wrapper each
 * handler picked — throw vs fallback — which is exactly what #1631 governs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const ROOT = '/vault';
/** What `rootPathFromEvent` reports; null models "no project open". */
let openProject: string | null = ROOT;

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => {
  /** Stands in for the real `MergeSourcesError` so the `instanceof` holds. */
  class FakeMergeSourcesError extends Error {
    constructor(message: string, public readonly code: string) {
      super(message);
      this.name = 'MergeSourcesError';
    }
  }
  return {
    handlers: new Map<string, Handler>(),
    win: { id: 1, isDestroyed: vi.fn(() => false), webContents: { send: vi.fn() } },
    MergeSourcesError: FakeMergeSourcesError,
    // electron / node
    showOpenDialog: vi.fn(),
    stat: vi.fn(),
    // ingest
    privilegedFetch: vi.fn(),
    ingestUrl: vi.fn(),
    ingestIdentifier: vi.fn(),
    ingestSmart: vi.fn(),
    ingestFile: vi.fn(),
    finishPdfOcrIngest: vi.fn(),
    readOriginalPdf: vi.fn(),
    getIngestSettings: vi.fn(),
    saveIngestSettings: vi.fn(),
    // source mutations
    deleteSource: vi.fn(),
    mergeSources: vi.fn(),
    setSourceReadStatus: vi.fn(),
    setSourceReadDueBy: vi.fn(),
    setSourceTitle: vi.fn(),
    addSourceTag: vi.fn(),
    removeSourceTag: vi.fn(),
    stripUpstreamTags: vi.fn(),
    createExcerpt: vi.fn(),
    // references / stubs
    mineSourceReferences: vi.fn(),
    createReferenceStubs: vi.fn(),
    resolveStub: vi.fn(),
    applyStubResolution: vi.fn(),
    // imports
    importBibtex: vi.fn(),
    importZoteroRdf: vi.fn(),
    // graph
    listAllSources: vi.fn(),
    getReadingQueueSourceIds: vi.fn(),
    sourcesByTag: vi.fn(),
    sourcesByReadStatus: vi.fn(),
    // collections
    loadCollections: vi.fn(),
    createCollection: vi.fn(),
    renameCollection: vi.fn(),
    deleteCollection: vi.fn(),
    addSourceToCollection: vi.fn(),
    removeSourceFromCollection: vi.fn(),
    createSmartCollection: vi.fn(),
    renameSmartCollection: vi.fn(),
    deleteSmartCollection: vi.fn(),
    updateSmartCollectionPredicate: vi.fn(),
    resolveSmartMembers: vi.fn(),
    // project config
    getExcerptNoteFolder: vi.fn(),
    setExcerptNoteFolder: vi.fn(),
    // helpers
    reindexFile: vi.fn(),
    persistIndexes: vi.fn(),
    broadcastSourcesChanged: vi.fn(),
    broadcastExcerptsChanged: vi.fn(),
    broadcastCollectionsChanged: vi.fn(),
    // call-order log — ordering is load-bearing in the ingest/OCR handlers
    order: [] as string[],
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { h.handlers.set(channel, fn); } },
  dialog: { showOpenDialog: h.showOpenDialog },
  BrowserWindow: class {},
}));

vi.mock('node:fs/promises', () => ({ default: { stat: h.stat }, stat: h.stat }));

vi.mock('../../../src/main/ipc/helpers', () => ({
  withRootPath:
    <A extends unknown[], R>(fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => {
        if (!openProject) throw new Error('No project open');
        return fn(openProject, ...args);
      },
  withRootPathOr:
    <A extends unknown[], R>(fallback: R, fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => (openProject ? fn(openProject, ...args) : fallback),
  withRootPathWin:
    <A extends unknown[], R>(fn: (rootPath: string, win: unknown, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => {
        if (!openProject) throw new Error('No project open');
        return fn(openProject, h.win, ...args);
      },
  reindexFile: h.reindexFile,
  persistIndexes: h.persistIndexes,
  broadcastSourcesChanged: h.broadcastSourcesChanged,
  broadcastExcerptsChanged: h.broadcastExcerptsChanged,
  broadcastCollectionsChanged: h.broadcastCollectionsChanged,
}));

vi.mock('../../../src/main/privileged-sites', () => ({ privilegedFetch: h.privilegedFetch }));
vi.mock('../../../src/main/sources/ingest', () => ({ ingestUrl: h.ingestUrl }));
vi.mock('../../../src/main/sources/ingest-identifier', () => ({ ingestIdentifier: h.ingestIdentifier }));
vi.mock('../../../src/main/sources/ingest-smart', () => ({ ingestSmart: h.ingestSmart }));
vi.mock('../../../src/main/sources/ingest-file', () => ({ ingestFile: h.ingestFile }));
vi.mock('../../../src/main/sources/ingest-pdf', () => ({
  finishPdfOcrIngest: h.finishPdfOcrIngest,
  readOriginalPdf: h.readOriginalPdf,
}));
vi.mock('../../../src/main/sources/ingest-settings', () => ({
  getIngestSettings: h.getIngestSettings,
  saveIngestSettings: h.saveIngestSettings,
}));
vi.mock('../../../src/main/sources/delete-source', () => ({ deleteSource: h.deleteSource }));
vi.mock('../../../src/main/sources/merge-sources', () => ({
  mergeSources: h.mergeSources,
  MergeSourcesError: h.MergeSourcesError,
}));
vi.mock('../../../src/main/sources/read-status', () => ({
  setSourceReadStatus: h.setSourceReadStatus,
  setSourceReadDueBy: h.setSourceReadDueBy,
}));
vi.mock('../../../src/main/sources/source-meta-write', () => ({
  setSourceTitle: h.setSourceTitle,
  addSourceTag: h.addSourceTag,
  removeSourceTag: h.removeSourceTag,
}));
vi.mock('../../../src/main/sources/strip-upstream-tags', () => ({ stripUpstreamTags: h.stripUpstreamTags }));
vi.mock('../../../src/main/sources/mine-references', () => ({ mineSourceReferences: h.mineSourceReferences }));
vi.mock('../../../src/main/sources/create-reference-stubs', () => ({ createReferenceStubs: h.createReferenceStubs }));
vi.mock('../../../src/main/sources/resolve-stub', () => ({
  resolveStub: h.resolveStub,
  applyStubResolution: h.applyStubResolution,
}));
vi.mock('../../../src/main/sources/import-bibtex', () => ({ importBibtex: h.importBibtex }));
vi.mock('../../../src/main/sources/import-zotero-rdf', () => ({ importZoteroRdf: h.importZoteroRdf }));
vi.mock('../../../src/main/sources/create-excerpt', () => ({ createExcerpt: h.createExcerpt }));
vi.mock('../../../src/main/sources/collections', () => ({
  loadCollections: h.loadCollections,
  createCollection: h.createCollection,
  renameCollection: h.renameCollection,
  deleteCollection: h.deleteCollection,
  addSourceToCollection: h.addSourceToCollection,
  removeSourceFromCollection: h.removeSourceFromCollection,
  createSmartCollection: h.createSmartCollection,
  renameSmartCollection: h.renameSmartCollection,
  deleteSmartCollection: h.deleteSmartCollection,
  updateSmartCollectionPredicate: h.updateSmartCollectionPredicate,
  resolveSmartMembers: h.resolveSmartMembers,
}));
vi.mock('../../../src/main/graph/index', () => ({
  listAllSources: h.listAllSources,
  getReadingQueueSourceIds: h.getReadingQueueSourceIds,
  sourcesByTag: h.sourcesByTag,
  sourcesByReadStatus: h.sourcesByReadStatus,
}));
vi.mock('../../../src/main/project-config', () => ({
  getExcerptNoteFolder: h.getExcerptNoteFolder,
  setExcerptNoteFolder: h.setExcerptNoteFolder,
}));

import { registerSources } from '../../../src/main/ipc/register-sources';
import { Channels } from '../../../src/shared/channels';

registerSources();

const call = (channel: string, ...args: unknown[]): unknown => h.handlers.get(channel)!({}, ...args);
/** Await a handler's answer whether it replied synchronously or with a promise. */
const callAsync = (channel: string, ...args: unknown[]): Promise<unknown> =>
  Promise.resolve(call(channel, ...args));
/**
 * Every "something changed" channel the handler announced, in call order
 * (#1916 — these go through `broadcastSourcesChanged`/`broadcastExcerptsChanged`/
 * `broadcastCollectionsChanged` now, each a separate mock, so ordering across
 * them is reconstructed from vitest's own invocation-order counters rather
 * than a single shared `webContents.send` log).
 */
const sent = (): unknown[] => {
  const marks: Array<{ order: number; channel: string }> = [];
  for (const [channel, fn] of [
    [Channels.SOURCES_CHANGED, h.broadcastSourcesChanged],
    [Channels.EXCERPTS_CHANGED, h.broadcastExcerptsChanged],
    [Channels.COLLECTIONS_CHANGED, h.broadcastCollectionsChanged],
  ] as const) {
    for (const order of fn.mock.invocationCallOrder) marks.push({ order, channel });
  }
  return marks.sort((a, b) => a.order - b.order).map((m) => m.channel);
};
/** The ProjectContext the registrar builds from the root path. */
const CTX = { rootPath: ROOT, _brand: 'ProjectContext' };

beforeEach(() => {
  // reset (not just clear): several tests install ordering/progress
  // `mockImplementation`s that must not leak into the next one.
  vi.resetAllMocks();
  openProject = ROOT;
  h.order.length = 0;
  h.win.isDestroyed.mockReturnValue(false);
  h.getIngestSettings.mockResolvedValue({ importUpstreamTags: true });
  h.listAllSources.mockReturnValue([]);
  h.loadCollections.mockResolvedValue({ collections: [], smartCollections: [] });
});

describe('register-sources — the #1631 project guard', () => {
  // Every source mutation and every single-source read. An empty answer here
  // would be a claim about a thoughtbase that isn't open.
  const throwers: [string, unknown[]][] = [
    [Channels.SOURCES_INGEST_URL, ['https://example.org/a']],
    [Channels.SOURCES_INGEST_IDENTIFIER, ['10.1234/x']],
    [Channels.SOURCES_INGEST_SMART, ['some input']],
    [Channels.SOURCES_INGEST_FILE, []],
    [Channels.SOURCES_MINE_REFERENCES, ['s1']],
    [Channels.SOURCES_CREATE_REFERENCE_STUBS, [{ sourceId: 's1', refs: [] }]],
    [Channels.SOURCES_RESOLVE_STUB, ['s1']],
    [Channels.SOURCES_APPLY_STUB_RESOLUTION, [{ sourceId: 's1', doi: '10.1/x' }]],
    [Channels.SOURCES_IMPORT_BIBTEX, []],
    [Channels.SOURCES_IMPORT_ZOTERO_RDF, []],
    [Channels.SOURCES_READ_PDF, ['s1']],
    [Channels.SOURCES_FINISH_PDF_OCR, ['s1', ['page one']]],
    [Channels.SOURCES_DELETE, ['s1']],
    [Channels.SOURCES_MERGE, [{ srcId: 'a', destId: 'b' }]],
    [Channels.SOURCES_SET_READ_STATUS, [{ sourceId: 's1', status: 'read' }]],
    [Channels.SOURCES_SET_READ_DUE_BY, [{ sourceId: 's1', dueBy: null }]],
    [Channels.SOURCES_SET_TITLE, [{ sourceId: 's1', title: 'T' }]],
    [Channels.SOURCES_ADD_TAG, [{ sourceId: 's1', tag: 't' }]],
    [Channels.SOURCES_REMOVE_TAG, [{ sourceId: 's1', tag: 't' }]],
    [Channels.SOURCES_STRIP_UPSTREAM_TAGS, ['s1']],
    [Channels.SOURCES_CREATE_EXCERPT, [{ sourceId: 's1', citedText: 'x' }]],
    [Channels.EXCERPT_SET_NOTE_FOLDER, ['Notes']],
    [Channels.COLLECTIONS_CREATE, [{ name: 'C' }]],
    [Channels.COLLECTIONS_RENAME, [{ id: 'c1', name: 'C' }]],
    [Channels.COLLECTIONS_DELETE, ['c1']],
    [Channels.COLLECTIONS_ADD_SOURCE, [{ collectionId: 'c1', sourceId: 's1' }]],
    [Channels.COLLECTIONS_REMOVE_SOURCE, [{ collectionId: 'c1', sourceId: 's1' }]],
    [Channels.COLLECTIONS_CREATE_SMART, [{ name: 'C', predicate: { kind: 'tags', allOf: [] } }]],
    [Channels.COLLECTIONS_RENAME_SMART, [{ id: 'c1', name: 'C' }]],
    [Channels.COLLECTIONS_DELETE_SMART, ['c1']],
    [Channels.COLLECTIONS_UPDATE_SMART_PREDICATE, [{ id: 'c1', predicate: { kind: 'tags', allOf: [] } }]],
  ];

  it.each(throwers)('%s throws with no project open', (channel, args) => {
    openProject = null;
    expect(() => call(channel, ...args)).toThrow('No project open');
  });

  it('nothing is ingested, written or deleted when there is no project', () => {
    openProject = null;
    for (const [channel, args] of throwers) {
      try { call(channel, ...args); } catch { /* asserted above */ }
    }
    expect(h.ingestUrl).not.toHaveBeenCalled();
    expect(h.ingestFile).not.toHaveBeenCalled();
    expect(h.deleteSource).not.toHaveBeenCalled();
    expect(h.mergeSources).not.toHaveBeenCalled();
    expect(h.createCollection).not.toHaveBeenCalled();
    expect(h.setExcerptNoteFolder).not.toHaveBeenCalled();
    // Not even a file picker: a cancelled-looking dialog with nowhere to put
    // the result is worse than the throw.
    expect(h.showOpenDialog).not.toHaveBeenCalled();
  });

  // Each of these fallbacks is also what the surface shows for a thoughtbase
  // that simply has nothing yet — a legitimate value per #1631 rule 2, not an
  // error signal wearing a value's clothes.
  const fallbacks: [string, unknown[], unknown][] = [
    [Channels.SOURCES_LIST_ALL, [], []],
    [Channels.SOURCES_QUEUE_MEMBERS, ['unread'], []],
    [Channels.EXCERPT_GET_NOTE_FOLDER, [], ''],
    [Channels.COLLECTIONS_LIST, [], { collections: [] }],
    [Channels.COLLECTIONS_SMART_MEMBERS, ['c1'], []],
  ];

  it.each(fallbacks)('%s answers with its empty value and reaches no domain module', async (channel, args, expected) => {
    openProject = null;
    await expect(callAsync(channel, ...args)).resolves.toEqual(expected);
    expect(h.listAllSources).not.toHaveBeenCalled();
    expect(h.loadCollections).not.toHaveBeenCalled();
    expect(h.getExcerptNoteFolder).not.toHaveBeenCalled();
  });

  it('COLLECTIONS_LIST\'s project-less answer is shaped like a real empty file', async () => {
    // The fallback omits `smartCollections` where `loadCollections` normalises
    // it to `[]`. That is only safe because the type marks it optional and the
    // panel reads `data.smartCollections ?? []` — pinned here so a caller that
    // starts trusting the field notices the two shapes differ.
    openProject = null;
    const projectless = await callAsync(Channels.COLLECTIONS_LIST);
    expect(projectless).toEqual({ collections: [] });
    expect((projectless as { smartCollections?: unknown[] }).smartCollections).toBeUndefined();
  });

  it('SOURCES_HAS_PDF throws with no project rather than answering "no PDF" (#1881)', () => {
    // Its `false` used to cover three facts — no project, no original.pdf, an
    // unreadable one — the same overload #1862 cleared from
    // NOTEBASE_FILE_EXISTS. Nothing can be asking about a source outside an
    // open thoughtbase, so there is no honest project-less answer here.
    openProject = null;
    expect(() => call(Channels.SOURCES_HAS_PDF, 's1')).toThrow('No project open');
    expect(h.stat).not.toHaveBeenCalled();
  });

  it('INGEST_GET_SETTINGS and INGEST_SET_SETTINGS work with no project — they are per-machine', async () => {
    openProject = null;
    h.getIngestSettings.mockResolvedValue({ importUpstreamTags: false });
    await expect(callAsync(Channels.INGEST_GET_SETTINGS)).resolves.toEqual({ importUpstreamTags: false });
    await callAsync(Channels.INGEST_SET_SETTINGS, { importUpstreamTags: true });
    expect(h.saveIngestSettings).toHaveBeenCalledWith({ importUpstreamTags: true });
  });
});

describe('register-sources — mutations persist their indexes and announce themselves', () => {
  // Eleven near-identical handlers. Each must persist the indexes AND tell the
  // window; a step missing from one of them is invisible on review.
  const mutations: [string, unknown[], () => void][] = [
    [Channels.SOURCES_DELETE, ['s1'], () => { h.deleteSource.mockResolvedValue({ removed: 1 }); }],
    [Channels.SOURCES_MERGE, [{ srcId: 'a', destId: 'b' }], () => { h.mergeSources.mockResolvedValue({ moved: 2 }); }],
    [Channels.SOURCES_SET_READ_STATUS, [{ sourceId: 's1', status: 'read' }], () => {}],
    [Channels.SOURCES_SET_READ_DUE_BY, [{ sourceId: 's1', dueBy: '2026-01-01' }], () => {}],
    [Channels.SOURCES_SET_TITLE, [{ sourceId: 's1', title: 'T' }], () => {}],
    [Channels.SOURCES_ADD_TAG, [{ sourceId: 's1', tag: 't' }], () => {}],
    [Channels.SOURCES_REMOVE_TAG, [{ sourceId: 's1', tag: 't' }], () => {}],
    [Channels.SOURCES_STRIP_UPSTREAM_TAGS, ['s1'], () => { h.stripUpstreamTags.mockResolvedValue({ removed: 3 }); }],
    [Channels.SOURCES_FINISH_PDF_OCR, ['s1', ['p1']], () => {}],
    [Channels.SOURCES_CREATE_REFERENCE_STUBS, [{ sourceId: 's1', refs: [] }], () => { h.createReferenceStubs.mockResolvedValue({ created: [] }); }],
    [Channels.SOURCES_APPLY_STUB_RESOLUTION, [{ sourceId: 's1', doi: '10.1/x' }], () => { h.applyStubResolution.mockResolvedValue(true); }],
  ];

  it.each(mutations)('%s persists the indexes and announces the change by rootPath', async (channel, args, arrange) => {
    arrange();
    await callAsync(channel, ...args);
    expect(h.persistIndexes).toHaveBeenCalledWith(ROOT);
    expect(sent()).toContain(Channels.SOURCES_CHANGED);
    // #1916: announced by rootPath (fans out to every window on the project),
    // not the invoking window — the bug was targeting `win` directly, which
    // left every OTHER window on the same thoughtbase stale.
    expect(h.broadcastSourcesChanged).toHaveBeenCalledWith(ROOT);
  });

  it('SOURCES_DELETE also refreshes the excerpt panels — its excerpts went with it', async () => {
    h.deleteSource.mockResolvedValue({ removed: 1 });
    await expect(callAsync(Channels.SOURCES_DELETE, 's1')).resolves.toEqual({ removed: 1 });
    expect(h.deleteSource).toHaveBeenCalledWith(ROOT, 's1');
    expect(sent()).toEqual([Channels.SOURCES_CHANGED, Channels.EXCERPTS_CHANGED]);
  });

  it('SOURCES_MERGE also refreshes the excerpt panels — they changed source', async () => {
    h.mergeSources.mockResolvedValue({ moved: 2 });
    await expect(callAsync(Channels.SOURCES_MERGE, { srcId: 'a', destId: 'b' })).resolves.toEqual({ moved: 2 });
    expect(h.mergeSources).toHaveBeenCalledWith(ROOT, 'a', 'b');
    expect(sent()).toEqual([Channels.SOURCES_CHANGED, Channels.EXCERPTS_CHANGED]);
  });

  it('the other mutations leave the excerpt panels alone', async () => {
    await callAsync(Channels.SOURCES_SET_TITLE, { sourceId: 's1', title: 'T' });
    expect(sent()).toEqual([Channels.SOURCES_CHANGED]);
  });

  it('SOURCES_SET_READ_STATUS forwards a null status as "clear the status"', async () => {
    await callAsync(Channels.SOURCES_SET_READ_STATUS, { sourceId: 's1', status: null });
    expect(h.setSourceReadStatus).toHaveBeenCalledWith(ROOT, 's1', null);
  });

  it('SOURCES_SET_READ_DUE_BY forwards a null date as "clear the due date"', async () => {
    await callAsync(Channels.SOURCES_SET_READ_DUE_BY, { sourceId: 's1', dueBy: null });
    expect(h.setSourceReadDueBy).toHaveBeenCalledWith(ROOT, 's1', null);
  });

  it.each([
    [Channels.SOURCES_ADD_TAG, 'addSourceTag'],
    [Channels.SOURCES_REMOVE_TAG, 'removeSourceTag'],
  ] as const)('%s applies the tag change to the source', async (channel, fn) => {
    await callAsync(channel, { sourceId: 's1', tag: 'ml' });
    expect(h[fn]).toHaveBeenCalledWith(ROOT, 's1', 'ml');
  });

  it('SOURCES_FINISH_PDF_OCR reindexes the source meta before persisting, so the OCR text is searchable', async () => {
    h.finishPdfOcrIngest.mockImplementation(async () => { h.order.push('ocr'); });
    h.reindexFile.mockImplementation(async () => { h.order.push('reindex'); });
    h.persistIndexes.mockImplementation(async () => { h.order.push('persist'); });

    await callAsync(Channels.SOURCES_FINISH_PDF_OCR, 's1', ['page one', 'page two']);

    expect(h.finishPdfOcrIngest).toHaveBeenCalledWith(ROOT, 's1', ['page one', 'page two']);
    expect(h.reindexFile).toHaveBeenCalledWith(ROOT, '.minerva/sources/s1/meta.ttl');
    // Rewrite → reindex → persist. Persisting first would snapshot the index
    // as it was before the OCR text landed in it.
    expect(h.order).toEqual(['ocr', 'reindex', 'persist']);
  });

  it('a failed mutation announces nothing', async () => {
    h.setSourceTitle.mockRejectedValue(new Error('EACCES'));
    await expect(callAsync(Channels.SOURCES_SET_TITLE, { sourceId: 's1', title: 'T' })).rejects.toThrow('EACCES');
    expect(h.persistIndexes).not.toHaveBeenCalled();
    expect(sent()).toEqual([]);
  });
});

describe('register-sources — SOURCES_MERGE error translation', () => {
  it('carries the structured code across the IPC boundary', async () => {
    // Without this the renderer sees a bare message and can't tell an expected
    // "you picked the same source twice" from an actual crash.
    h.mergeSources.mockRejectedValue(new h.MergeSourcesError('cannot merge a source into itself', 'same-source'));

    const err = await callAsync(Channels.SOURCES_MERGE, { srcId: 'a', destId: 'a' })
      .then(() => null, (e: unknown) => e as Error & { code?: string });

    expect(err).toBeInstanceOf(Error);
    expect(err?.message).toBe('cannot merge a source into itself');
    expect(err?.code).toBe('same-source');
  });

  it('does not persist or announce a merge that failed', async () => {
    h.mergeSources.mockRejectedValue(new h.MergeSourcesError('no such source', 'not-found'));
    await expect(callAsync(Channels.SOURCES_MERGE, { srcId: 'a', destId: 'b' })).rejects.toThrow('no such source');
    expect(h.persistIndexes).not.toHaveBeenCalled();
    expect(sent()).toEqual([]);
  });

  it('lets a genuine crash through untouched', async () => {
    // Only MergeSourcesError is translated. Wrapping everything would dress a
    // real bug up as an expected outcome — and lose the original stack.
    const boom = new Error('EIO');
    h.mergeSources.mockRejectedValue(boom);
    await expect(callAsync(Channels.SOURCES_MERGE, { srcId: 'a', destId: 'b' })).rejects.toBe(boom);
  });
});

describe('register-sources — ingest', () => {
  it.each([
    [Channels.SOURCES_INGEST_URL, 'https://example.org/a', 'ingestUrl'],
    [Channels.SOURCES_INGEST_IDENTIFIER, '10.1234/abc', 'ingestIdentifier'],
    [Channels.SOURCES_INGEST_SMART, 'anything at all', 'ingestSmart'],
  ] as const)('%s fetches through the privileged wrapper and honours the tag preference', async (channel, input, fn) => {
    // A bare `fetch` would bypass the per-site credential/header handling, and
    // a hardcoded tag flag would ignore the user's ingest setting.
    h.getIngestSettings.mockResolvedValue({ importUpstreamTags: false });
    h[fn].mockResolvedValue({ sourceId: 's9' });

    await expect(callAsync(channel, input)).resolves.toEqual({ sourceId: 's9' });
    expect(h[fn]).toHaveBeenCalledWith(ROOT, input, {
      fetchImpl: h.privilegedFetch,
      importUpstreamTags: false,
    });
  });

  it('SOURCES_INGEST_FILE reindexes the new source so it appears in the sidebar', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/paper.pdf'] });
    h.ingestFile.mockResolvedValue({ sourceId: 'src-42' });

    await expect(callAsync(Channels.SOURCES_INGEST_FILE)).resolves.toEqual({ sourceId: 'src-42' });

    expect(h.ingestFile).toHaveBeenCalledWith(ROOT, '/tmp/paper.pdf');
    expect(h.reindexFile).toHaveBeenCalledWith(ROOT, '.minerva/sources/src-42/meta.ttl');
    expect(h.persistIndexes).toHaveBeenCalledWith(ROOT);
  });

  it.each([
    ['cancelled', { canceled: true, filePaths: [] }],
    ['dismissed with no path', { canceled: false, filePaths: [] }],
  ])('SOURCES_INGEST_FILE imports nothing when the picker is %s', async (_label, dialogResult) => {
    h.showOpenDialog.mockResolvedValue(dialogResult);
    await expect(callAsync(Channels.SOURCES_INGEST_FILE)).resolves.toBeNull();
    expect(h.ingestFile).not.toHaveBeenCalled();
    expect(h.persistIndexes).not.toHaveBeenCalled();
  });

  it('SOURCES_RESOLVE_STUB looks the reference up through the privileged fetcher', async () => {
    h.resolveStub.mockResolvedValue({ doi: '10.1/x' });
    await expect(callAsync(Channels.SOURCES_RESOLVE_STUB, 's1')).resolves.toEqual({ doi: '10.1/x' });
    expect(h.resolveStub).toHaveBeenCalledWith(ROOT, 's1', { fetchImpl: h.privilegedFetch });
  });

  it('SOURCES_APPLY_STUB_RESOLUTION reports whether the stub was actually filled in', async () => {
    h.applyStubResolution.mockResolvedValue(false);
    await expect(callAsync(Channels.SOURCES_APPLY_STUB_RESOLUTION, { sourceId: 's1', doi: '10.1/x' }))
      .resolves.toEqual({ ok: false });
    expect(h.applyStubResolution).toHaveBeenCalledWith(ROOT, 's1', '10.1/x', { fetchImpl: h.privilegedFetch });
  });

  it('SOURCES_MINE_REFERENCES returns the parsed references', async () => {
    h.mineSourceReferences.mockResolvedValue([{ title: 'A paper' }]);
    await expect(callAsync(Channels.SOURCES_MINE_REFERENCES, 's1')).resolves.toEqual([{ title: 'A paper' }]);
    expect(h.mineSourceReferences).toHaveBeenCalledWith(ROOT, 's1');
  });

  it('SOURCES_CREATE_REFERENCE_STUBS passes the parsed refs straight through', async () => {
    const refs = [{ title: 'A paper', doi: '10.1/x' }];
    h.createReferenceStubs.mockResolvedValue({ created: ['stub-1'] });
    await expect(callAsync(Channels.SOURCES_CREATE_REFERENCE_STUBS, { sourceId: 's1', refs }))
      .resolves.toEqual({ created: ['stub-1'] });
    expect(h.createReferenceStubs).toHaveBeenCalledWith(ROOT, 's1', refs);
  });

  it('SOURCES_READ_PDF hands the original bytes back for the renderer OCR worker', async () => {
    h.readOriginalPdf.mockResolvedValue(new Uint8Array([37, 80]));
    await expect(callAsync(Channels.SOURCES_READ_PDF, 's1')).resolves.toEqual(new Uint8Array([37, 80]));
    expect(h.readOriginalPdf).toHaveBeenCalledWith(ROOT, 's1');
  });

  it('SOURCES_HAS_PDF reports true when the original was kept', async () => {
    h.stat.mockResolvedValue({});
    await expect(callAsync(Channels.SOURCES_HAS_PDF, 's1')).resolves.toBe(true);
    expect(h.stat).toHaveBeenCalledWith('/vault/.minerva/sources/s1/original.pdf');
  });

  it('SOURCES_HAS_PDF surfaces an unreadable file instead of calling it absent (#1881)', async () => {
    // The distinction the old blanket catch erased: a PDF that is there but
    // can't be stat'd is a problem to report, not a source without a PDF.
    h.stat.mockRejectedValue(Object.assign(new Error('EACCES'), { code: 'EACCES' }));
    await expect(callAsync(Channels.SOURCES_HAS_PDF, 's1')).rejects.toThrow('EACCES');
  });

  it('SOURCES_HAS_PDF reports false for a source ingested without one', async () => {
    h.stat.mockRejectedValue(Object.assign(new Error('ENOENT'), { code: 'ENOENT' }));
    await expect(callAsync(Channels.SOURCES_HAS_PDF, 's1')).resolves.toBe(false);
  });
});

describe('register-sources — bibliography imports', () => {
  it.each([
    [Channels.SOURCES_IMPORT_BIBTEX, 'importBibtex', Channels.SOURCES_IMPORT_BIBTEX_PROGRESS],
    [Channels.SOURCES_IMPORT_ZOTERO_RDF, 'importZoteroRdf', Channels.SOURCES_IMPORT_ZOTERO_RDF_PROGRESS],
  ] as const)('%s streams progress to the window while it runs', async (channel, fn, progressChannel) => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/refs.bib'] });
    h[fn].mockImplementation(async (_root: string, _file: string, opts: { onProgress: (p: unknown) => void }) => {
      opts.onProgress({ done: 1, total: 2 });
      opts.onProgress({ done: 2, total: 2 });
      return { imported: 2 };
    });

    await expect(callAsync(channel)).resolves.toEqual({ imported: 2 });
    expect(h[fn]).toHaveBeenCalledWith(ROOT, '/tmp/refs.bib', { onProgress: expect.any(Function) });
    // A long import has to move a progress bar, not freeze the dialog.
    expect(h.win.webContents.send.mock.calls).toEqual([
      [progressChannel, { done: 1, total: 2 }],
      [progressChannel, { done: 2, total: 2 }],
    ]);
  });

  it.each([
    [Channels.SOURCES_IMPORT_BIBTEX, 'importBibtex', { canceled: true, filePaths: [] }],
    [Channels.SOURCES_IMPORT_BIBTEX, 'importBibtex', { canceled: false, filePaths: [] }],
    [Channels.SOURCES_IMPORT_ZOTERO_RDF, 'importZoteroRdf', { canceled: true, filePaths: [] }],
    [Channels.SOURCES_IMPORT_ZOTERO_RDF, 'importZoteroRdf', { canceled: false, filePaths: [] }],
  ] as const)('%s imports nothing when the picker gives back no file', async (channel, fn, dialogResult) => {
    h.showOpenDialog.mockResolvedValue(dialogResult);
    await expect(callAsync(channel)).resolves.toBeNull();
    expect(h[fn]).not.toHaveBeenCalled();
  });

  it('a progress tick after the window closed is dropped, not sent', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/tmp/refs.bib'] });
    h.importBibtex.mockImplementation(async (_root: string, _file: string, opts: { onProgress: (p: unknown) => void }) => {
      h.win.isDestroyed.mockReturnValue(true);
      opts.onProgress({ done: 1, total: 2 });
      return { imported: 1 };
    });
    await expect(callAsync(Channels.SOURCES_IMPORT_BIBTEX)).resolves.toEqual({ imported: 1 });
    expect(h.win.webContents.send).not.toHaveBeenCalled();
  });
});

describe('register-sources — reading queue and smart collections', () => {
  it('SOURCES_QUEUE_MEMBERS returns only the sources in the requested view', () => {
    h.getReadingQueueSourceIds.mockReturnValue(['s1', 's3']);
    h.listAllSources.mockReturnValue([{ sourceId: 's1' }, { sourceId: 's2' }, { sourceId: 's3' }]);

    expect(call(Channels.SOURCES_QUEUE_MEMBERS, 'unread')).toEqual([{ sourceId: 's1' }, { sourceId: 's3' }]);
    expect(h.getReadingQueueSourceIds).toHaveBeenCalledWith(CTX, 'unread');
  });

  it('SOURCES_QUEUE_MEMBERS skips listing every source when the queue is empty', () => {
    // Intersecting the whole library against nothing is pure waste on a large
    // thoughtbase, and the answer is [] either way.
    h.getReadingQueueSourceIds.mockReturnValue([]);
    expect(call(Channels.SOURCES_QUEUE_MEMBERS, 'unread')).toEqual([]);
    expect(h.listAllSources).not.toHaveBeenCalled();
  });

  it('SOURCES_LIST_ALL reads the graph for the open project', () => {
    h.listAllSources.mockReturnValue([{ sourceId: 's1' }]);
    expect(call(Channels.SOURCES_LIST_ALL)).toEqual([{ sourceId: 's1' }]);
    expect(h.listAllSources).toHaveBeenCalledWith(CTX);
  });

  it('COLLECTIONS_SMART_MEMBERS resolves membership through the graph', async () => {
    h.loadCollections.mockResolvedValue({
      collections: [],
      smartCollections: [{ id: 'sc1', predicate: { kind: 'tags', allOf: ['ml'] } }],
    });
    h.resolveSmartMembers.mockReturnValue(new Set(['s2']));
    h.listAllSources.mockReturnValue([{ sourceId: 's1' }, { sourceId: 's2' }]);

    await expect(callAsync(Channels.COLLECTIONS_SMART_MEMBERS, 'sc1')).resolves.toEqual([{ sourceId: 's2' }]);
    expect(h.resolveSmartMembers).toHaveBeenCalledWith(
      { kind: 'tags', allOf: ['ml'] },
      { sourcesByTag: expect.any(Function), sourcesByReadStatus: expect.any(Function) },
    );
  });

  it('the lookups it hands the resolver read from the graph, not a local cache', async () => {
    // The graph is the source of truth for hasTag edges, so smart-collection
    // membership matches what the tag panel shows.
    h.loadCollections.mockResolvedValue({
      collections: [], smartCollections: [{ id: 'sc1', predicate: { kind: 'tags', allOf: ['ml'] } }],
    });
    h.resolveSmartMembers.mockImplementation((_p: unknown, lookups: {
      sourcesByTag: (t: string) => unknown; sourcesByReadStatus: (s: string) => unknown;
    }) => {
      lookups.sourcesByTag('ml');
      lookups.sourcesByReadStatus('unread');
      return new Set<string>();
    });

    await callAsync(Channels.COLLECTIONS_SMART_MEMBERS, 'sc1');

    expect(h.sourcesByTag).toHaveBeenCalledWith(CTX, 'ml');
    expect(h.sourcesByReadStatus).toHaveBeenCalledWith(CTX, 'unread');
  });

  it('COLLECTIONS_SMART_MEMBERS returns nothing for an id that no longer exists', async () => {
    h.loadCollections.mockResolvedValue({ collections: [], smartCollections: [] });
    await expect(callAsync(Channels.COLLECTIONS_SMART_MEMBERS, 'gone')).resolves.toEqual([]);
    expect(h.resolveSmartMembers).not.toHaveBeenCalled();
  });

  it('COLLECTIONS_SMART_MEMBERS skips listing every source when nothing matched', async () => {
    h.loadCollections.mockResolvedValue({
      collections: [], smartCollections: [{ id: 'sc1', predicate: { kind: 'tags', allOf: ['nope'] } }],
    });
    h.resolveSmartMembers.mockReturnValue(new Set());
    await expect(callAsync(Channels.COLLECTIONS_SMART_MEMBERS, 'sc1')).resolves.toEqual([]);
    expect(h.listAllSources).not.toHaveBeenCalled();
  });
});

describe('register-sources — collections', () => {
  const collectionMutations: [string, unknown[], () => void][] = [
    [Channels.COLLECTIONS_CREATE, [{ name: 'C' }], () => { h.createCollection.mockResolvedValue({ id: 'c1' }); }],
    [Channels.COLLECTIONS_RENAME, [{ id: 'c1', name: 'C2' }], () => {}],
    [Channels.COLLECTIONS_DELETE, ['c1'], () => {}],
    [Channels.COLLECTIONS_ADD_SOURCE, [{ collectionId: 'c1', sourceId: 's1' }], () => {}],
    [Channels.COLLECTIONS_REMOVE_SOURCE, [{ collectionId: 'c1', sourceId: 's1' }], () => {}],
    [Channels.COLLECTIONS_CREATE_SMART, [{ name: 'S', predicate: { kind: 'tags', allOf: [] } }], () => { h.createSmartCollection.mockResolvedValue({ id: 'sc1' }); }],
    [Channels.COLLECTIONS_RENAME_SMART, [{ id: 'sc1', name: 'S2' }], () => {}],
    [Channels.COLLECTIONS_DELETE_SMART, ['sc1'], () => {}],
    [Channels.COLLECTIONS_UPDATE_SMART_PREDICATE, [{ id: 'sc1', predicate: { kind: 'tags', allOf: ['x'] } }], () => {}],
  ];

  it.each(collectionMutations)('%s announces the change by rootPath, to every window on the project', async (channel, args, arrange) => {
    arrange();
    await callAsync(channel, ...args);
    expect(sent()).toEqual([Channels.COLLECTIONS_CHANGED]);
    // #1916: by rootPath, same as the source mutations above — not `win`.
    expect(h.broadcastCollectionsChanged).toHaveBeenCalledWith(ROOT);
  });

  it('collection edits do not touch the source indexes', async () => {
    // Collections live in their own JSON file, not the graph — persisting the
    // search/graph indexes on every rename would be wasted IO.
    await callAsync(Channels.COLLECTIONS_RENAME, { id: 'c1', name: 'C2' });
    expect(h.renameCollection).toHaveBeenCalledWith(ROOT, 'c1', 'C2');
    expect(h.persistIndexes).not.toHaveBeenCalled();
  });

  it('COLLECTIONS_CREATE forwards the parent so nesting works', async () => {
    h.createCollection.mockResolvedValue({ id: 'c2' });
    await expect(callAsync(Channels.COLLECTIONS_CREATE, { name: 'Child', parent: 'c1' }))
      .resolves.toEqual({ id: 'c2' });
    expect(h.createCollection).toHaveBeenCalledWith(ROOT, { name: 'Child', parent: 'c1' });
  });

  it('COLLECTIONS_LIST returns the stored file for the open project', async () => {
    h.loadCollections.mockResolvedValue({ collections: [{ id: 'c1' }], smartCollections: [] });
    await expect(callAsync(Channels.COLLECTIONS_LIST))
      .resolves.toEqual({ collections: [{ id: 'c1' }], smartCollections: [] });
    expect(h.loadCollections).toHaveBeenCalledWith(ROOT);
  });

  it.each([
    [Channels.COLLECTIONS_ADD_SOURCE, 'addSourceToCollection'],
    [Channels.COLLECTIONS_REMOVE_SOURCE, 'removeSourceFromCollection'],
  ] as const)('%s moves the membership on the named collection', async (channel, fn) => {
    await callAsync(channel, { collectionId: 'c1', sourceId: 's1' });
    expect(h[fn]).toHaveBeenCalledWith(ROOT, 'c1', 's1');
  });
});

describe('register-sources — excerpts', () => {
  it('SOURCES_CREATE_EXCERPT passes the anchor through unchanged', async () => {
    // The anchor fields are what re-locates a quote in the source later; a
    // handler that dropped `pageRange`/`locationText` would silently produce
    // unanchored excerpts.
    const params = { sourceId: 's1', citedText: 'a quote', page: 12, pageRange: '12-13', locationText: 'ch. 2' };
    h.createExcerpt.mockResolvedValue({ excerptId: 'ex1' });
    await expect(callAsync(Channels.SOURCES_CREATE_EXCERPT, params)).resolves.toEqual({ excerptId: 'ex1' });
    expect(h.createExcerpt).toHaveBeenCalledWith(ROOT, params);
  });

  it('EXCERPT_GET_NOTE_FOLDER reports the configured default', () => {
    h.getExcerptNoteFolder.mockReturnValue('Notes/Excerpts');
    expect(call(Channels.EXCERPT_GET_NOTE_FOLDER)).toBe('Notes/Excerpts');
    expect(h.getExcerptNoteFolder).toHaveBeenCalledWith(ROOT);
  });

  it('EXCERPT_SET_NOTE_FOLDER stores the new default', () => {
    call(Channels.EXCERPT_SET_NOTE_FOLDER, 'Notes/Excerpts');
    expect(h.setExcerptNoteFolder).toHaveBeenCalledWith(ROOT, 'Notes/Excerpts');
  });
});
