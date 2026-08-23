/**
 * @vitest-environment node
 *
 * Main-process coverage for `register-types.ts` (#1840).
 *
 * This registrar is the clearest example in the tree of #1631's two-wrapper
 * split, so that's what it's pinned on:
 *
 *   - the four READS (`TYPES_LIST`, `TYPES_NOTE_PROPERTIES`, `TYPES_INSTANCES`,
 *     `TYPES_NOTE_TYPE_MAP`) use `withRootPathOr`, and each fallback is a
 *     legitimate value — the SAME shape the domain returns when a project is
 *     open and genuinely has nothing. Every one of them is asserted against
 *     that real empty answer rather than against a hand-written literal, so a
 *     fallback that drifted into meaning "error" (a `null`, an `{ error }`, a
 *     differently-shaped stub) would fail here.
 *   - the four WRITES (`TYPES_SAVE`, `TYPES_DELETE`, `TYPES_DELETE_SAFELY`,
 *     `TYPES_RENAME`) use `withRootPath`: they throw with no project open and
 *     touch nothing, because there is no such thing as saving a type into no
 *     thoughtbase.
 *
 * Also pinned: `errors[]` is a per-item catalog (#1631 rule 4) — a malformed
 * type file is reported next to the types that loaded, and the call succeeds;
 * the graph's type catalog is reloaded AFTER a write, and not at all if the
 * write failed; and `toTypeInfo` (the real one) keeps `filePath` off the wire.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { TypeDef } from '../../../src/shared/objects/type-def';

const ROOT = '/vault';
/** What `rootPathFromEvent` reports; null models "no project open". */
let openProject: string | null = ROOT;

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => ({
  handlers: new Map<string, Handler>(),
  // types/*
  loadTypeCatalog: vi.fn(),
  saveType: vi.fn(),
  deleteType: vi.fn(),
  deleteTypeSafely: vi.fn(),
  renameType: vi.fn(),
  // graph/*
  getNoteTypedProperties: vi.fn(),
  getTypeInstances: vi.fn(),
  getNoteTypeMap: vi.fn(),
  reloadTypeCatalog: vi.fn(),
  /** Call-order log — the catalog reload has to follow the write. */
  order: [] as string[],
}));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { h.handlers.set(channel, fn); } },
}));

vi.mock('../../../src/main/ipc/helpers', () => ({
  rootPathFromEvent: () => openProject,
  withRootPath:
    <A extends unknown[], R>(fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => {
        if (!openProject) throw new Error('No project open');
        return fn(openProject, ...args);
      },
  withRootPathOr:
    <A extends unknown[], R>(fallback: R, fn: (rootPath: string, ...a: A) => R) =>
      (_e: unknown, ...args: A): R => (openProject ? fn(openProject, ...args) : fallback),
}));

vi.mock('../../../src/main/types/loader', () => ({ loadTypeCatalog: h.loadTypeCatalog }));
vi.mock('../../../src/main/types/write', () => ({
  saveType: (...a: unknown[]) => { h.order.push('saveType'); return h.saveType(...a); },
  deleteType: (...a: unknown[]) => { h.order.push('deleteType'); return h.deleteType(...a); },
}));
vi.mock('../../../src/main/types/migrate', () => ({
  deleteTypeSafely: h.deleteTypeSafely,
  renameType: h.renameType,
}));
vi.mock('../../../src/main/graph/index', () => ({
  getNoteTypedProperties: h.getNoteTypedProperties,
  getTypeInstances: h.getTypeInstances,
  getNoteTypeMap: h.getNoteTypeMap,
  reloadTypeCatalog: (...a: unknown[]) => { h.order.push('reloadTypeCatalog'); return h.reloadTypeCatalog(...a); },
}));
vi.mock('../../../src/main/project-context-types', () => ({
  projectContext: (rootPath: string) => ({ rootPath }),
}));

import { registerTypes } from '../../../src/main/ipc/register-types';
import { Channels } from '../../../src/shared/channels';

registerTypes();

const call = (channel: string, ...args: unknown[]) => h.handlers.get(channel)!({}, ...args);
/** `call` wrapped so a SYNCHRONOUS throw (the `withRootPath` guard fires before
 *  the async body runs) is assertable with the same `rejects` matcher. */
const callAsync = async (channel: string, ...args: unknown[]) => call(channel, ...args);

const BOOK: TypeDef = {
  id: 'book',
  label: 'Book',
  classLocalName: 'Book',
  properties: [{ name: 'author', type: 'text' }],
  template: '## Notes\n',
  source: 'stock',
  filePath: '/vault/.minerva/types/book.md',
};

beforeEach(() => {
  vi.clearAllMocks();
  h.order.length = 0;
  openProject = ROOT;
});

describe('the reads answer an empty project and no project identically', () => {
  it('TYPES_LIST: an empty catalog is the same `{ types: [], errors: [] }` either way', async () => {
    h.loadTypeCatalog.mockResolvedValue({ types: [], errors: [] });
    const withProject = await call(Channels.TYPES_LIST);

    openProject = null;
    const withoutProject = await call(Channels.TYPES_LIST);

    // The fallback isn't a disguised error — it's the answer a project with no
    // types gives, so the picker renders "nothing yet" in both cases.
    expect(withoutProject).toEqual(withProject);
    expect(withoutProject).toEqual({ types: [], errors: [] });
    expect(h.loadTypeCatalog).toHaveBeenCalledTimes(1); // never reached without a project
  });

  it('TYPES_NOTE_PROPERTIES: an untyped note and no project both answer `{ type: null, properties: [] }`', async () => {
    h.getNoteTypedProperties.mockReturnValue({ type: null, properties: [] });
    const untyped = await call(Channels.TYPES_NOTE_PROPERTIES, 'notes/a.md');

    openProject = null;
    const noProject = await call(Channels.TYPES_NOTE_PROPERTIES, 'notes/a.md');

    expect(noProject).toEqual(untyped);
    expect(h.getNoteTypedProperties).toHaveBeenCalledTimes(1);
  });

  it('TYPES_INSTANCES: an unused type and no project both answer `{ type: null, instances: [] }`', async () => {
    h.getTypeInstances.mockReturnValue({ type: null, instances: [] });
    const unused = await call(Channels.TYPES_INSTANCES, 'book');

    openProject = null;
    const noProject = await call(Channels.TYPES_INSTANCES, 'book');

    expect(noProject).toEqual(unused);
    expect(h.getTypeInstances).toHaveBeenCalledTimes(1);
  });

  it('TYPES_NOTE_TYPE_MAP: "nothing is typed yet" and no project are both `{}`', async () => {
    h.getNoteTypeMap.mockReturnValue({});
    const nothingTyped = await call(Channels.TYPES_NOTE_TYPE_MAP);

    openProject = null;
    const noProject = await call(Channels.TYPES_NOTE_TYPE_MAP);

    expect(noProject).toEqual(nothingTyped);
    expect(h.getNoteTypeMap).toHaveBeenCalledTimes(1);
  });
});

describe('the reads with a project open', () => {
  it('TYPES_LIST serializes the catalog without the on-disk path', async () => {
    h.loadTypeCatalog.mockResolvedValue({ types: [BOOK], errors: [] });

    const result = await call(Channels.TYPES_LIST) as { types: Array<Record<string, unknown>> };

    expect(h.loadTypeCatalog).toHaveBeenCalledWith(ROOT);
    // The template body DOES cross (it's a note scaffold, not an LLM prompt) —
    // the picker instantiates from it without a round-trip.
    expect(result.types[0]).toMatchObject({ id: 'book', label: 'Book', template: '## Notes\n' });
    expect(result.types[0]).not.toHaveProperty('filePath');
  });

  it('TYPES_LIST reports a broken type file alongside the ones that loaded (#1631 rule 4)', async () => {
    const broken = { source: 'user', filePath: '/vault/.minerva/types/bad.md', label: 'bad.md', message: 'no `label:`' };
    h.loadTypeCatalog.mockResolvedValue({ types: [BOOK], errors: [broken] });

    const result = await call(Channels.TYPES_LIST) as { types: unknown[]; errors: unknown[] };

    // The call succeeded; `errors` describes the items, it isn't the outcome.
    expect(result.types).toHaveLength(1);
    expect(result.errors).toEqual([broken]);
  });

  it('TYPES_LIST rethrows a genuine load failure instead of answering an empty catalog', async () => {
    h.loadTypeCatalog.mockRejectedValue(new Error('EACCES: permission denied'));
    // `{ types: [], errors: [] }` here would tell the picker every type had been
    // deleted — the fallback means "none", never "couldn't look".
    await expect(callAsync(Channels.TYPES_LIST)).rejects.toThrow(/EACCES/);
  });

  it('TYPES_NOTE_PROPERTIES projects the note over the indexed graph', async () => {
    const props = { type: 'book', properties: [{ name: 'author', type: 'text', value: 'Lamport' }] };
    h.getNoteTypedProperties.mockReturnValue(props);

    await expect(callAsync(Channels.TYPES_NOTE_PROPERTIES, 'notes/paxos.md')).resolves.toEqual(props);
    expect(h.getNoteTypedProperties).toHaveBeenCalledWith({ rootPath: ROOT }, 'notes/paxos.md');
  });

  it('TYPES_INSTANCES lists every note of a type', async () => {
    const instances = { type: 'book', instances: [{ path: 'notes/paxos.md', values: {} }] };
    h.getTypeInstances.mockReturnValue(instances);

    await expect(callAsync(Channels.TYPES_INSTANCES, 'book')).resolves.toEqual(instances);
    expect(h.getTypeInstances).toHaveBeenCalledWith({ rootPath: ROOT }, 'book');
  });

  it('TYPES_NOTE_TYPE_MAP keys the note rows by type', async () => {
    h.getNoteTypeMap.mockReturnValue({ 'notes/paxos.md': 'book' });
    await expect(callAsync(Channels.TYPES_NOTE_TYPE_MAP)).resolves.toEqual({ 'notes/paxos.md': 'book' });
    expect(h.getNoteTypeMap).toHaveBeenCalledWith({ rootPath: ROOT });
  });
});

describe('the writes', () => {
  it('TYPES_SAVE writes the file, THEN reloads the graph catalog', async () => {
    h.saveType.mockResolvedValue({ id: 'book', filePath: '/vault/.minerva/types/book.md' });

    await expect(callAsync(Channels.TYPES_SAVE, { label: 'Book', properties: [] }))
      .resolves.toEqual({ id: 'book', filePath: '/vault/.minerva/types/book.md' });

    expect(h.saveType).toHaveBeenCalledWith(ROOT, { label: 'Book', properties: [] });
    // Reloading first would re-read the catalog without the new type, leaving
    // it unusable for promotion/indexing until the next reload.
    expect(h.order).toEqual(['saveType', 'reloadTypeCatalog']);
    expect(h.reloadTypeCatalog).toHaveBeenCalledWith({ rootPath: ROOT });
  });

  it('TYPES_SAVE does not reload the catalog when the write failed', async () => {
    h.saveType.mockRejectedValue(new Error('EROFS: read-only file system'));
    await expect(callAsync(Channels.TYPES_SAVE, { label: 'Book' })).rejects.toThrow(/EROFS/);
    expect(h.reloadTypeCatalog).not.toHaveBeenCalled();
  });

  it('TYPES_DELETE removes the file, THEN reloads the catalog', async () => {
    await call(Channels.TYPES_DELETE, 'book');
    expect(h.deleteType).toHaveBeenCalledWith(ROOT, 'book');
    expect(h.order).toEqual(['deleteType', 'reloadTypeCatalog']);
  });

  it('TYPES_DELETE_SAFELY reports what it cleared and what it could not (#1588)', async () => {
    const outcome = { cleared: ['notes/a.md'], failed: [{ path: 'notes/b.md', error: 'EACCES' }] };
    h.deleteTypeSafely.mockResolvedValue(outcome);

    // A per-note outcome catalog: the delete succeeded, and the caller can see
    // which instances were left behind.
    await expect(callAsync(Channels.TYPES_DELETE_SAFELY, 'book', true)).resolves.toEqual(outcome);
    expect(h.deleteTypeSafely).toHaveBeenCalledWith(ROOT, 'book', true);
  });

  it('TYPES_DELETE_SAFELY passes `clearInstances: false` through unchanged', async () => {
    h.deleteTypeSafely.mockResolvedValue({ cleared: [], failed: [] });
    await call(Channels.TYPES_DELETE_SAFELY, 'book', false);
    // Leaving instances typed vs clearing them is the user's explicit choice;
    // the handler must not helpfully default it.
    expect(h.deleteTypeSafely).toHaveBeenCalledWith(ROOT, 'book', false);
  });

  it('TYPES_RENAME migrates every instance to the new id', async () => {
    const outcome = { newId: 'monograph', migrated: ['notes/a.md'], failed: [] };
    h.renameType.mockResolvedValue(outcome);

    await expect(callAsync(Channels.TYPES_RENAME, 'book', 'Monograph')).resolves.toEqual(outcome);
    expect(h.renameType).toHaveBeenCalledWith(ROOT, 'book', 'Monograph');
  });

  it.each([
    [Channels.TYPES_SAVE, [{ label: 'Book' }]],
    [Channels.TYPES_DELETE, ['book']],
    [Channels.TYPES_DELETE_SAFELY, ['book', true]],
    [Channels.TYPES_RENAME, ['book', 'Monograph']],
  ])('%s throws with no project open', async (channel, args) => {
    openProject = null;
    await expect(callAsync(channel, ...args)).rejects.toThrow(/No project open/);
  });

  it('none of the writes touched disk or the graph with no project open', async () => {
    openProject = null;
    await expect(callAsync(Channels.TYPES_SAVE, {})).rejects.toThrow();
    await expect(callAsync(Channels.TYPES_DELETE, 'book')).rejects.toThrow();
    await expect(callAsync(Channels.TYPES_DELETE_SAFELY, 'book', true)).rejects.toThrow();
    await expect(callAsync(Channels.TYPES_RENAME, 'book', 'Monograph')).rejects.toThrow();

    expect(h.saveType).not.toHaveBeenCalled();
    expect(h.deleteType).not.toHaveBeenCalled();
    expect(h.deleteTypeSafely).not.toHaveBeenCalled();
    expect(h.renameType).not.toHaveBeenCalled();
    expect(h.reloadTypeCatalog).not.toHaveBeenCalled();
  });
});
