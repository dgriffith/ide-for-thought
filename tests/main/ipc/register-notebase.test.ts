/**
 * @vitest-environment node
 *
 * Main-process coverage for `register-notebase.ts` (#1840).
 *
 * This is the write path — create / write / delete / rename / merge / copy —
 * and it was the largest registrar with no direct test, against CLAUDE.md's
 * "does every register-* handler ship with a main-process test?" checklist.
 * It drives the REAL `registerNotebase()` (and the real `broadcast`) with its
 * collaborators mocked, and pins the behaviour a renderer actually depends on:
 *
 *   - the #1631 project guard: every mutating handler THROWS "No project open",
 *     while the genuinely list-shaped reads answer with an empty value;
 *   - the write pipeline is invoked with `suppressRewrittenBroadcast` so a
 *     renderer-initiated save doesn't get told about its own write;
 *   - index bookkeeping happens in the order that makes it correct (a folder's
 *     files are enumerated BEFORE the folder is deleted, `markPathHandled`
 *     fires BEFORE the fs mutation the watcher would otherwise re-emit);
 *   - rename / merge / rename-anchor broadcast the right channels to every
 *     window on the project, and stay quiet when nothing changed;
 *   - a cancelled picker is a no-op, never a half-open project.
 *
 * `withRootPath*` are re-implemented in the helpers mock with the real
 * semantics (helpers.ts drags in electron + graph/search/vectors, so it can't
 * be imported here). Their own contract is covered by
 * tests/main/ipc/registration.test.ts; what matters here is WHICH wrapper each
 * handler picked — throw vs fallback — which is exactly what #1631 governs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

const ROOT = '/vault';
/** What `rootPathFromEvent` reports; null models "no project open". */
let openProject: string | null = ROOT;

type Handler = (event: unknown, ...args: unknown[]) => unknown;

const h = vi.hoisted(() => {
  const makeWin = (id: number) => ({
    id,
    isDestroyed: () => false,
    webContents: { send: vi.fn(), once: vi.fn() },
  });
  return {
    handlers: new Map<string, Handler>(),
    win: makeWin(1),
    freshWin: makeWin(2),
    // electron
    showOpenDialog: vi.fn(),
    showSaveDialog: vi.fn(),
    // node:fs/promises
    stat: vi.fn(),
    // notebase/fs
    openNotebase: vi.fn(),
    listFiles: vi.fn(),
    readFile: vi.fn(),
    readBinaryFile: vi.fn(),
    writeBinaryFile: vi.fn(),
    fileExists: vi.fn(),
    createFile: vi.fn(),
    deleteFile: vi.fn(),
    createFolder: vi.fn(),
    deleteFolder: vi.fn(),
    copyItem: vi.fn(),
    // notebase collaborators
    renameWithLinkRewrites: vi.fn(),
    mergeNotes: vi.fn(),
    previewMergeNotes: vi.fn(),
    renameAnchor: vi.fn(),
    renameSource: vi.fn(),
    renameExcerpt: vi.fn(),
    dropImport: vi.fn(),
    installTutorialThoughtbase: vi.fn(),
    searchInNotes: vi.fn(),
    replaceInNotes: vi.fn(),
    writeAndReindex: vi.fn(),
    // offline caches
    getOrFetchThumbnail: vi.fn(),
    getOrFetchRemoteImage: vi.fn(),
    // project config
    resolveDisplayName: vi.fn(),
    setDisplayName: vi.fn(),
    getDisplayName: vi.fn(),
    readProjectConfig: vi.fn(),
    getOnboardingDismissed: vi.fn(),
    setOnboardingDismissed: vi.fn(),
    // indexes
    indexNote: vi.fn(),
    searchIndexNote: vi.fn(),
    vectorsIndexNote: vi.fn(),
    searchRemoveNote: vi.fn(),
    vectorsRemoveNote: vi.fn(),
    // window manager / menu / recents
    createWindow: vi.fn(),
    openProjectInWindow: vi.fn(),
    closeProjectInWindow: vi.fn(),
    markPathHandled: vi.fn(),
    clearRecentProjects: vi.fn(),
    rebuildMenu: vi.fn(),
    // helpers
    reindexFile: vi.fn(),
    removeFromIndexes: vi.fn(),
    listIndexableFiles: vi.fn(),
    persistIndexes: vi.fn(),
    broadcastRewritten: vi.fn(),
    // call-order log — ordering is load-bearing in several handlers
    order: [] as string[],
  };
});

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { h.handlers.set(channel, fn); } },
  dialog: { showOpenDialog: h.showOpenDialog, showSaveDialog: h.showSaveDialog },
}));

vi.mock('node:fs/promises', () => ({ default: { stat: h.stat }, stat: h.stat }));

vi.mock('../../../src/main/ipc/helpers', () => ({
  winFromEvent: () => h.win,
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
  reindexFile: h.reindexFile,
  removeFromIndexes: h.removeFromIndexes,
  listIndexableFiles: h.listIndexableFiles,
  persistIndexes: h.persistIndexes,
  broadcastRewritten: h.broadcastRewritten,
  hooks: { HOOKS: true },
}));

vi.mock('../../../src/main/notebase/fs', () => ({
  openNotebase: h.openNotebase,
  listFiles: h.listFiles,
  readFile: h.readFile,
  readBinaryFile: h.readBinaryFile,
  writeBinaryFile: h.writeBinaryFile,
  fileExists: h.fileExists,
  createFile: h.createFile,
  deleteFile: h.deleteFile,
  createFolder: h.createFolder,
  deleteFolder: h.deleteFolder,
  copyItem: h.copyItem,
}));

vi.mock('../../../src/main/notebase/rename', () => ({ renameWithLinkRewrites: h.renameWithLinkRewrites }));
vi.mock('../../../src/main/notebase/merge', () => ({ mergeNotes: h.mergeNotes, previewMergeNotes: h.previewMergeNotes }));
vi.mock('../../../src/main/notebase/rename-anchor', () => ({ renameAnchor: h.renameAnchor }));
vi.mock('../../../src/main/notebase/rename-source-excerpt', () => ({ renameSource: h.renameSource, renameExcerpt: h.renameExcerpt }));
vi.mock('../../../src/main/notebase/drop-import', () => ({ dropImport: h.dropImport }));
vi.mock('../../../src/main/notebase/install-tutorial', () => ({
  installTutorialThoughtbase: h.installTutorialThoughtbase,
  TUTORIAL_DEFAULT_NAME: 'Minerva Tutorial',
}));
vi.mock('../../../src/main/notebase/search-in-notes', () => ({ searchInNotes: h.searchInNotes, replaceInNotes: h.replaceInNotes }));
vi.mock('../../../src/main/notebase/write-pipeline', () => ({ writeAndReindex: h.writeAndReindex }));
vi.mock('../../../src/main/images/remote-image-cache', () => ({ getOrFetchRemoteImage: h.getOrFetchRemoteImage }));
vi.mock('../../../src/main/youtube/thumbnail-cache', () => ({ getOrFetchThumbnail: h.getOrFetchThumbnail }));
vi.mock('../../../src/main/project-config', () => ({
  resolveDisplayName: h.resolveDisplayName,
  setDisplayName: h.setDisplayName,
  getDisplayName: h.getDisplayName,
  readProjectConfig: h.readProjectConfig,
  getOnboardingDismissed: h.getOnboardingDismissed,
  setOnboardingDismissed: h.setOnboardingDismissed,
}));
vi.mock('../../../src/main/graph/index', () => ({ indexNote: h.indexNote }));
vi.mock('../../../src/main/search/index', () => ({ indexNote: h.searchIndexNote, removeNote: h.searchRemoveNote }));
vi.mock('../../../src/main/embeddings/vector-store', () => ({ indexNote: h.vectorsIndexNote, removeNote: h.vectorsRemoveNote }));
vi.mock('../../../src/main/recent-projects', () => ({
  clearRecentProjects: h.clearRecentProjects,
  defaultThoughtbaseDir: () => '/home/user/Thoughtbases',
}));
vi.mock('../../../src/main/menu', () => ({ rebuildMenu: h.rebuildMenu }));
vi.mock('../../../src/main/window-manager', () => ({
  createWindow: h.createWindow,
  openProjectInWindow: h.openProjectInWindow,
  closeProjectInWindow: h.closeProjectInWindow,
  markPathHandled: h.markPathHandled,
  windowsForProject: () => [h.win],
}));

import { registerNotebase } from '../../../src/main/ipc/register-notebase';
import { Channels } from '../../../src/shared/channels';

registerNotebase();

const call = (channel: string, ...args: unknown[]): unknown => h.handlers.get(channel)!({}, ...args);
/** Every `webContents.send` a handler made on the project's window. */
const sends = (): unknown[][] => h.win.webContents.send.mock.calls;
/** The ProjectContext the registrar builds from the root path. */
const CTX = { rootPath: ROOT, _brand: 'ProjectContext' };

beforeEach(() => {
  // reset (not just clear): several tests install ordering `mockImplementation`s
  // that must not leak into the next one.
  vi.resetAllMocks();
  openProject = ROOT;
  h.order.length = 0;
  h.createWindow.mockReturnValue(h.freshWin);
  h.resolveDisplayName.mockReturnValue('My Vault');
  h.readProjectConfig.mockReturnValue({});
});

/** Fire the `did-finish-load` callback a "…in new window" handler registered. */
async function finishLoad(): Promise<void> {
  const last = h.freshWin.webContents.once.mock.calls.at(-1) as [string, () => Promise<void>];
  expect(last[0]).toBe('did-finish-load');
  await last[1]();
}

describe('register-notebase — the #1631 project guard', () => {
  // CLAUDE.md rule 2: "no project open" throws. Each of these mutates or reads
  // one specific file, so an empty answer would be a lie, not a value.
  const throwers: [string, unknown[]][] = [
    [Channels.NOTEBASE_READ_FILE, ['a.md']],
    [Channels.NOTEBASE_READ_BINARY, ['img.png']],
    [Channels.NOTEBASE_WRITE_BINARY, ['img.png', new Uint8Array([1])]],
    [Channels.NOTEBASE_WRITE_FILE, ['a.md', 'body']],
    [Channels.NOTEBASE_CREATE_FILE, ['a.md']],
    [Channels.NOTEBASE_DELETE_FILE, ['a.md']],
    [Channels.NOTEBASE_CREATE_FOLDER, ['dir']],
    [Channels.NOTEBASE_DELETE_FOLDER, ['dir']],
    [Channels.NOTEBASE_RENAME, ['a.md', 'b.md']],
    [Channels.NOTEBASE_MERGE, ['a.md', 'b.md']],
    [Channels.NOTEBASE_MERGE_PREVIEW, ['a.md', 'b.md']],
    [Channels.NOTEBASE_RENAME_SOURCE, ['old', 'new']],
    [Channels.NOTEBASE_RENAME_EXCERPT, ['old', 'new']],
    [Channels.NOTEBASE_RENAME_ANCHOR, ['a.md', 'old', 'new']],
    [Channels.NOTEBASE_COPY, ['a.md', 'b.md']],
    [Channels.NOTEBASE_GET_PROPERTIES, []],
    [Channels.NOTEBASE_SET_DISPLAY_NAME, ['name']],
    [Channels.NOTEBASE_SET_ONBOARDING_DISMISSED, [true]],
    [Channels.FILES_DROP_IMPORT, ['dir', ['/tmp/x.pdf']]],
    [Channels.YOUTUBE_THUMBNAIL, ['vid']],
    [Channels.IMAGES_CACHE_EXTERNAL, ['https://x/y.png']],
  ];

  it.each(throwers)('%s throws with no project open', (channel, args) => {
    openProject = null;
    expect(() => call(channel, ...args)).toThrow('No project open');
  });

  it('no mutation reaches the filesystem when there is no project', () => {
    openProject = null;
    for (const [channel, args] of throwers) {
      try { call(channel, ...args); } catch { /* asserted above */ }
    }
    expect(h.writeAndReindex).not.toHaveBeenCalled();
    expect(h.createFile).not.toHaveBeenCalled();
    expect(h.deleteFile).not.toHaveBeenCalled();
    expect(h.deleteFolder).not.toHaveBeenCalled();
    expect(h.renameWithLinkRewrites).not.toHaveBeenCalled();
    expect(h.mergeNotes).not.toHaveBeenCalled();
  });

  it('NOTEBASE_LIST_FILES answers with an empty listing, not a throw', async () => {
    // A legitimate value per #1631 rule 2: "no project" and "a project with no
    // files" both render as an empty sidebar, so the fallback isn't a lie.
    openProject = null;
    await expect(call(Channels.NOTEBASE_LIST_FILES)).resolves.toEqual([]);
    expect(h.listFiles).not.toHaveBeenCalled();
  });

  it('NOTEBASE_SEARCH_IN_NOTES answers with no matches, not a throw', async () => {
    openProject = null;
    await expect(call(Channels.NOTEBASE_SEARCH_IN_NOTES, { query: 'x' })).resolves.toEqual([]);
    expect(h.searchInNotes).not.toHaveBeenCalled();
  });

  it('NOTEBASE_GET_ONBOARDING_DISMISSED answers "not dismissed" with no project', async () => {
    // The one `withRootPathOr` in this registrar. `false` is the same answer a
    // brand-new thoughtbase gives, so the project-less fallback isn't an error
    // signal wearing a value's clothes.
    openProject = null;
    expect(call(Channels.NOTEBASE_GET_ONBOARDING_DISMISSED)).toBe(false);
    expect(h.getOnboardingDismissed).not.toHaveBeenCalled();
  });

  it('NOTEBASE_REPLACE_IN_NOTES throws rather than reporting a successful no-op', () => {
    // It used to answer `{ changedPaths: [], replacedCount: 0 }`, so the
    // find/replace dialog said "Replaced 0 matches" for a call that never ran
    // (#1862). This is a WRITE: "nothing matched" and "there was nothing to
    // search" are different facts, and only one of them is a success.
    openProject = null;
    expect(() => call(Channels.NOTEBASE_REPLACE_IN_NOTES, { query: 'x', replacement: 'y', selections: [] }))
      .toThrow('No project open');
    expect(h.replaceInNotes).not.toHaveBeenCalled();
  });

  it('NOTEBASE_FILE_EXISTS throws instead of answering "no such file"', () => {
    // `false` now means exactly one thing (#1862). It used to mean that OR "no
    // project", so a caller checking before a write couldn't tell "safe to
    // create" from "there is nowhere to create it".
    openProject = null;
    expect(() => call(Channels.NOTEBASE_FILE_EXISTS, 'a.md')).toThrow('No project open');
    expect(h.fileExists).not.toHaveBeenCalled();
  });
});

describe('register-notebase — reads', () => {
  it('NOTEBASE_LIST_FILES delegates to the fs listing', async () => {
    h.listFiles.mockResolvedValue([{ path: 'a.md' }]);
    await expect(call(Channels.NOTEBASE_LIST_FILES)).resolves.toEqual([{ path: 'a.md' }]);
    expect(h.listFiles).toHaveBeenCalledWith(ROOT);
  });

  it('NOTEBASE_READ_FILE returns the file body', async () => {
    h.readFile.mockResolvedValue('# Title');
    await expect(call(Channels.NOTEBASE_READ_FILE, 'notes/a.md')).resolves.toBe('# Title');
    expect(h.readFile).toHaveBeenCalledWith(ROOT, 'notes/a.md');
  });

  it('NOTEBASE_READ_BINARY returns the raw bytes', async () => {
    h.readBinaryFile.mockResolvedValue(new Uint8Array([137, 80]));
    await expect(call(Channels.NOTEBASE_READ_BINARY, 'img.png')).resolves.toEqual(new Uint8Array([137, 80]));
  });

  it('NOTEBASE_FILE_EXISTS reports the fs answer when a project is open', async () => {
    h.fileExists.mockResolvedValue(true);
    await expect(call(Channels.NOTEBASE_FILE_EXISTS, 'a.md')).resolves.toBe(true);
    expect(h.fileExists).toHaveBeenCalledWith(ROOT, 'a.md');
  });

  it('NOTEBASE_SEARCH_IN_NOTES passes the search options straight through', async () => {
    h.searchInNotes.mockResolvedValue([{ path: 'a.md', matches: [] }]);
    const opts = { query: 'todo', regex: false, caseSensitive: true };
    await expect(call(Channels.NOTEBASE_SEARCH_IN_NOTES, opts)).resolves.toEqual([{ path: 'a.md', matches: [] }]);
    expect(h.searchInNotes).toHaveBeenCalledWith(ROOT, opts);
  });

  it('NOTEBASE_MERGE_PREVIEW returns the preview without touching disk', async () => {
    h.previewMergeNotes.mockResolvedValue({ merged: 'a\n\nb' });
    await expect(call(Channels.NOTEBASE_MERGE_PREVIEW, 'a.md', 'b.md')).resolves.toEqual({ merged: 'a\n\nb' });
    expect(h.mergeNotes).not.toHaveBeenCalled();
  });

  it('NOTEBASE_GET_PROPERTIES falls back to empty strings for an unnamed thoughtbase', async () => {
    h.getDisplayName.mockReturnValue(undefined);
    h.readProjectConfig.mockReturnValue({});
    expect(call(Channels.NOTEBASE_GET_PROPERTIES)).toEqual({
      displayName: '',
      folderName: path.basename(ROOT),
      baseUri: '',
    });
  });

  it('NOTEBASE_GET_PROPERTIES reports the stored name and base IRI', async () => {
    h.getDisplayName.mockReturnValue('My Vault');
    h.readProjectConfig.mockReturnValue({ baseUri: 'https://example.org/kb/' });
    expect(call(Channels.NOTEBASE_GET_PROPERTIES)).toMatchObject({
      displayName: 'My Vault',
      baseUri: 'https://example.org/kb/',
    });
  });

  it('NOTEBASE_GET_ONBOARDING_DISMISSED reports the stored flag', () => {
    h.getOnboardingDismissed.mockReturnValue(true);
    expect(call(Channels.NOTEBASE_GET_ONBOARDING_DISMISSED)).toBe(true);
    expect(h.getOnboardingDismissed).toHaveBeenCalledWith(ROOT);
  });
});

describe('register-notebase — the write path', () => {
  it('NOTEBASE_WRITE_FILE suppresses the rewritten broadcast for a renderer save', async () => {
    // The renderer already holds the content it just saved; re-broadcasting it
    // would bounce the buffer back into the editor it came from.
    await call(Channels.NOTEBASE_WRITE_FILE, 'notes/a.md', 'body');
    expect(h.writeAndReindex).toHaveBeenCalledWith(
      ROOT, 'notes/a.md', 'body', { HOOKS: true }, { suppressRewrittenBroadcast: true },
    );
  });

  it('NOTEBASE_WRITE_FILE propagates a pipeline failure instead of swallowing it', async () => {
    h.writeAndReindex.mockRejectedValue(new Error('EACCES'));
    await expect(call(Channels.NOTEBASE_WRITE_FILE, 'a.md', 'body')).rejects.toThrow('EACCES');
  });

  it('NOTEBASE_CREATE_FILE claims the path before creating it, then indexes it empty', async () => {
    h.markPathHandled.mockImplementation(() => { h.order.push('mark'); });
    h.createFile.mockImplementation(async () => { h.order.push('create'); });

    await call(Channels.NOTEBASE_CREATE_FILE, 'notes/new.md');

    // The watcher must be told to ignore this path BEFORE the file appears, or
    // it races the create and re-emits it as an external change.
    expect(h.order).toEqual(['mark', 'create']);
    expect(h.indexNote).toHaveBeenCalledWith(CTX, 'notes/new.md', '');
    expect(h.searchIndexNote).toHaveBeenCalledWith(CTX, 'notes/new.md', '');
  });

  it('NOTEBASE_DELETE_FILE claims the path, deletes, de-indexes, then persists', async () => {
    h.markPathHandled.mockImplementation(() => { h.order.push('mark'); });
    h.deleteFile.mockImplementation(async () => { h.order.push('delete'); });
    h.removeFromIndexes.mockImplementation(() => { h.order.push('deindex'); });
    h.persistIndexes.mockImplementation(async () => { h.order.push('persist'); });

    await call(Channels.NOTEBASE_DELETE_FILE, 'notes/a.md');

    expect(h.order).toEqual(['mark', 'delete', 'deindex', 'persist']);
    expect(h.removeFromIndexes).toHaveBeenCalledWith(ROOT, 'notes/a.md');
  });

  it('NOTEBASE_DELETE_FOLDER enumerates the folder BEFORE deleting it', async () => {
    // Enumerating after the delete would list nothing, and every note in the
    // folder would linger in the graph + search index as a ghost.
    h.listIndexableFiles.mockImplementation(async () => { h.order.push('list'); return ['dir/a.md', 'dir/b.md']; });
    h.deleteFolder.mockImplementation(async () => { h.order.push('delete'); });
    h.removeFromIndexes.mockImplementation(() => { h.order.push('deindex'); });
    h.persistIndexes.mockImplementation(async () => { h.order.push('persist'); });

    await call(Channels.NOTEBASE_DELETE_FOLDER, 'dir');

    expect(h.order).toEqual(['list', 'delete', 'deindex', 'deindex', 'persist']);
    expect(h.removeFromIndexes.mock.calls).toEqual([[ROOT, 'dir/a.md'], [ROOT, 'dir/b.md']]);
    expect(h.persistIndexes).toHaveBeenCalledWith(ROOT);
  });

  it('NOTEBASE_CREATE_FOLDER delegates to the fs helper', async () => {
    await call(Channels.NOTEBASE_CREATE_FOLDER, 'a/b');
    expect(h.createFolder).toHaveBeenCalledWith(ROOT, 'a/b');
  });

  it('NOTEBASE_WRITE_BINARY re-wraps a structured-clone Buffer as a Uint8Array view', async () => {
    // Electron's bridge hands a Buffer at this end; anything else is wrapped so
    // `writeBinaryFile` always sees a strict Uint8Array.
    await call(Channels.NOTEBASE_WRITE_BINARY, 'img.png', Buffer.from([1, 2, 3]));
    const written = h.writeBinaryFile.mock.calls[0]![2] as Uint8Array;
    expect(written).toBeInstanceOf(Uint8Array);
    expect([...written]).toEqual([1, 2, 3]);
  });

  it('NOTEBASE_COPY reindexes every file under a copied directory', async () => {
    h.stat.mockResolvedValue({ isDirectory: () => true });
    h.listIndexableFiles.mockResolvedValue(['dest/a.md', 'dest/b.md']);

    await call(Channels.NOTEBASE_COPY, 'src', 'dest');

    expect(h.copyItem).toHaveBeenCalledWith(ROOT, 'src', 'dest');
    expect(h.reindexFile.mock.calls).toEqual([[ROOT, 'dest/a.md'], [ROOT, 'dest/b.md']]);
  });

  it('NOTEBASE_COPY reindexes just the file when the copy is a single note', async () => {
    h.stat.mockResolvedValue({ isDirectory: () => false });
    await call(Channels.NOTEBASE_COPY, 'a.md', 'b.md');
    expect(h.reindexFile.mock.calls).toEqual([[ROOT, 'b.md']]);
    expect(h.listIndexableFiles).not.toHaveBeenCalled();
  });

  it('FILES_DROP_IMPORT defaults a null target folder to the project root', async () => {
    h.dropImport.mockResolvedValue({ imported: [] });
    await call(Channels.FILES_DROP_IMPORT, null, null);
    expect(h.dropImport).toHaveBeenCalledWith(ROOT, '', []);
  });

  it('NOTEBASE_SET_ONBOARDING_DISMISSED stores a strict boolean', async () => {
    await call(Channels.NOTEBASE_SET_ONBOARDING_DISMISSED, 'yes');
    expect(h.setOnboardingDismissed).toHaveBeenCalledWith(ROOT, false);
    await call(Channels.NOTEBASE_SET_ONBOARDING_DISMISSED, true);
    expect(h.setOnboardingDismissed).toHaveBeenLastCalledWith(ROOT, true);
  });

  it('NOTEBASE_SET_DISPLAY_NAME returns fresh meta so every label updates at once', () => {
    h.resolveDisplayName.mockReturnValue('Renamed');
    expect(call(Channels.NOTEBASE_SET_DISPLAY_NAME, 'Renamed')).toEqual({
      rootPath: ROOT, name: 'Renamed',
    });
    expect(h.setDisplayName).toHaveBeenCalledWith(ROOT, 'Renamed');
  });
});

describe('register-notebase — rename / merge broadcasts', () => {
  it('NOTEBASE_RENAME tells open tabs about both the move and the rewritten links', async () => {
    h.renameWithLinkRewrites.mockResolvedValue({
      transitions: [{ old: 'a.md', new: 'b.md' }],
      rewrittenPaths: ['c.md'],
    });

    await call(Channels.NOTEBASE_RENAME, 'a.md', 'b.md');

    expect(sends()).toEqual([
      [Channels.NOTEBASE_RENAMED, [{ old: 'a.md', new: 'b.md' }]],
      [Channels.NOTEBASE_REWRITTEN, ['c.md']],
    ]);
    expect(h.persistIndexes).toHaveBeenCalledWith(ROOT);
  });

  it('NOTEBASE_RENAME stays quiet when nothing moved and nothing was rewritten', async () => {
    h.renameWithLinkRewrites.mockResolvedValue({ transitions: [], rewrittenPaths: [] });
    await call(Channels.NOTEBASE_RENAME, 'a.md', 'a.md');
    expect(sends()).toEqual([]);
  });

  it("NOTEBASE_RENAME's reindex hook routes only markdown to search + vectors", async () => {
    h.renameWithLinkRewrites.mockImplementation(async (
      _root: string, _old: string, _new: string,
      opts: { reindexHook: (p: string, c: string) => void; removeHook: (p: string) => void },
    ) => {
      opts.reindexHook('b.md', 'body');
      opts.reindexHook('data.csv', 'x,y'); // a first-class note, but not full-text/vector indexed
      opts.removeHook('a.md');
      return { transitions: [], rewrittenPaths: [] };
    });

    await call(Channels.NOTEBASE_RENAME, 'a.md', 'b.md');

    expect(h.searchIndexNote.mock.calls).toEqual([[CTX, 'b.md', 'body']]);
    expect(h.vectorsIndexNote).toHaveBeenCalledTimes(1);
    expect(h.searchRemoveNote).toHaveBeenCalledWith(CTX, 'a.md');
    expect(h.vectorsRemoveNote).toHaveBeenCalledWith(CTX, 'a.md');
  });

  it('NOTEBASE_MERGE signals the source note as deleted and refreshes the target', async () => {
    h.mergeNotes.mockResolvedValue({ rewrittenPaths: ['c.md'] });

    const result = await call(Channels.NOTEBASE_MERGE, 'a.md', 'b.md', '\n---\n');

    // The empty `new` is the agreed deletion sentinel — editor tabs on the
    // source close instead of pointing at a file that no longer exists.
    expect(sends()).toEqual([
      [Channels.NOTEBASE_RENAMED, [{ old: 'a.md', new: '' }]],
      [Channels.NOTEBASE_REWRITTEN, ['c.md', 'b.md']],
    ]);
    expect(result).toEqual({ rewrittenPaths: ['c.md'] });
    expect(h.mergeNotes).toHaveBeenCalledWith(ROOT, 'a.md', 'b.md', expect.objectContaining({ separator: '\n---\n' }));
  });

  it('NOTEBASE_MERGE still refreshes the target when no links were rewritten', async () => {
    h.mergeNotes.mockResolvedValue({ rewrittenPaths: [] });
    await call(Channels.NOTEBASE_MERGE, 'a.md', 'b.md');
    expect(sends()).toEqual([
      [Channels.NOTEBASE_RENAMED, [{ old: 'a.md', new: '' }]],
      [Channels.NOTEBASE_REWRITTEN, ['b.md']],
    ]);
  });

  it('NOTEBASE_MERGE omits the separator key entirely when the caller passed none', async () => {
    h.mergeNotes.mockResolvedValue({ rewrittenPaths: [] });
    await call(Channels.NOTEBASE_MERGE, 'a.md', 'b.md');
    const opts = h.mergeNotes.mock.calls[0]![3] as Record<string, unknown>;
    // Not `separator: undefined` — the merge module's own default must win.
    expect(Object.hasOwn(opts, 'separator')).toBe(false);
  });

  it('NOTEBASE_RENAME_ANCHOR refreshes only the notes whose links moved', async () => {
    h.renameAnchor.mockResolvedValue({ rewrittenPaths: ['c.md'] });
    await expect(call(Channels.NOTEBASE_RENAME_ANCHOR, 'a.md', 'old', 'new'))
      .resolves.toEqual({ rewrittenPaths: ['c.md'] });
    expect(sends()).toEqual([[Channels.NOTEBASE_REWRITTEN, ['c.md']]]);
  });

  it('NOTEBASE_RENAME_ANCHOR broadcasts nothing when no link pointed at the heading', async () => {
    h.renameAnchor.mockResolvedValue({ rewrittenPaths: [] });
    await call(Channels.NOTEBASE_RENAME_ANCHOR, 'a.md', 'old', 'new');
    expect(sends()).toEqual([]);
  });

  it('NOTEBASE_RENAME_SOURCE reports the rewritten notes and refreshes them', async () => {
    h.renameSource.mockResolvedValue({ rewrittenPaths: ['a.md'] });
    await expect(call(Channels.NOTEBASE_RENAME_SOURCE, 'old', 'new')).resolves.toEqual({ rewrittenPaths: ['a.md'] });
    expect(h.broadcastRewritten).toHaveBeenCalledWith(ROOT, ['a.md']);
  });

  it('NOTEBASE_RENAME_EXCERPT reports the rewritten notes and refreshes them', async () => {
    h.renameExcerpt.mockResolvedValue({ rewrittenPaths: ['a.md'] });
    await expect(call(Channels.NOTEBASE_RENAME_EXCERPT, 'old', 'new')).resolves.toEqual({ rewrittenPaths: ['a.md'] });
    expect(h.broadcastRewritten).toHaveBeenCalledWith(ROOT, ['a.md']);
  });
});

describe('register-notebase — find & replace', () => {
  it('NOTEBASE_REPLACE_IN_NOTES reindexes, persists, then refreshes the changed notes', async () => {
    h.replaceInNotes.mockResolvedValue({ changedPaths: ['a.md', 'b.md'], replacedCount: 3 });

    const result = await call(Channels.NOTEBASE_REPLACE_IN_NOTES, { query: 'x', replacement: 'y', selections: [] });

    expect(result).toEqual({ changedPaths: ['a.md', 'b.md'], replacedCount: 3 });
    expect(h.reindexFile.mock.calls).toEqual([[ROOT, 'a.md'], [ROOT, 'b.md']]);
    expect(h.persistIndexes).toHaveBeenCalledWith(ROOT);
    expect(h.broadcastRewritten).toHaveBeenCalledWith(ROOT, ['a.md', 'b.md']);
  });

  it('NOTEBASE_REPLACE_IN_NOTES skips the reindex when nothing matched', async () => {
    h.replaceInNotes.mockResolvedValue({ changedPaths: [], replacedCount: 0 });
    await call(Channels.NOTEBASE_REPLACE_IN_NOTES, { query: 'x', replacement: 'y', selections: [] });
    expect(h.reindexFile).not.toHaveBeenCalled();
    expect(h.broadcastRewritten).not.toHaveBeenCalled();
  });
});

describe('register-notebase — project lifecycle', () => {
  it('NOTEBASE_OPEN opens the picked thoughtbase in the invoking window', async () => {
    h.openNotebase.mockResolvedValue({ rootPath: '/picked', name: 'Picked' });
    await expect(call(Channels.NOTEBASE_OPEN)).resolves.toEqual({ rootPath: '/picked', name: 'Picked' });
    expect(h.openProjectInWindow).toHaveBeenCalledWith(h.win, '/picked');
  });

  it('NOTEBASE_OPEN leaves the current project alone when the picker is cancelled', async () => {
    h.openNotebase.mockResolvedValue(null);
    await expect(call(Channels.NOTEBASE_OPEN)).resolves.toBeNull();
    expect(h.openProjectInWindow).not.toHaveBeenCalled();
  });

  it('NOTEBASE_OPEN_PATH opens a known path and resolves its display name', async () => {
    await expect(call(Channels.NOTEBASE_OPEN_PATH, '/other')).resolves.toEqual({ rootPath: '/other', name: 'My Vault' });
    expect(h.openProjectInWindow).toHaveBeenCalledWith(h.win, '/other');
  });

  it('NOTEBASE_NEW_PROJECT is a no-op when the directory picker is cancelled', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await expect(call(Channels.NOTEBASE_NEW_PROJECT)).resolves.toBeNull();
    expect(h.openProjectInWindow).not.toHaveBeenCalled();
  });

  it('NOTEBASE_NEW_PROJECT is a no-op when the picker returns no path', async () => {
    // "not cancelled but empty" is a real Electron shape; both arms have to
    // read as "the user chose nothing".
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: [] });
    await expect(call(Channels.NOTEBASE_NEW_PROJECT)).resolves.toBeNull();
    expect(h.openProjectInWindow).not.toHaveBeenCalled();
  });

  it('NOTEBASE_NEW_PROJECT opens the chosen directory in this window', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/new'] });
    await expect(call(Channels.NOTEBASE_NEW_PROJECT)).resolves.toEqual({ rootPath: '/new', name: 'My Vault' });
    expect(h.openProjectInWindow).toHaveBeenCalledWith(h.win, '/new');
  });

  it('NOTEBASE_CLOSE releases the project held by the invoking window', () => {
    expect(call(Channels.NOTEBASE_CLOSE)).toBeNull();
    expect(h.closeProjectInWindow).toHaveBeenCalledWith(h.win.id);
  });

  it('RECENT_CLEAR empties the list and rebuilds the menu that shows it', () => {
    call(Channels.RECENT_CLEAR);
    expect(h.clearRecentProjects).toHaveBeenCalled();
    expect(h.rebuildMenu).toHaveBeenCalled();
  });

  it('NOTEBASE_OPEN_IN_NEW_WINDOW defers the open until the fresh window has loaded', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/other'] });

    await call(Channels.NOTEBASE_OPEN_IN_NEW_WINDOW);
    // Nothing opened yet — the renderer isn't listening until did-finish-load.
    expect(h.openProjectInWindow).not.toHaveBeenCalled();

    await finishLoad();
    expect(h.openProjectInWindow).toHaveBeenCalledWith(h.freshWin, '/other');
    expect(h.freshWin.webContents.send).toHaveBeenCalledWith(
      Channels.PROJECT_OPENED, { rootPath: '/other', name: 'My Vault' },
    );
  });

  it('NOTEBASE_OPEN_IN_NEW_WINDOW creates no window when the picker is cancelled', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await expect(call(Channels.NOTEBASE_OPEN_IN_NEW_WINDOW)).resolves.toBeNull();
    expect(h.createWindow).not.toHaveBeenCalled();
  });

  it('NOTEBASE_NEW_PROJECT_IN_NEW_WINDOW creates the window and opens after load', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: false, filePaths: ['/new'] });
    await expect(call(Channels.NOTEBASE_NEW_PROJECT_IN_NEW_WINDOW))
      .resolves.toEqual({ rootPath: '/new', name: 'My Vault' });
    await finishLoad();
    expect(h.openProjectInWindow).toHaveBeenCalledWith(h.freshWin, '/new');
  });

  it('NOTEBASE_NEW_PROJECT_IN_NEW_WINDOW creates no window when cancelled', async () => {
    h.showOpenDialog.mockResolvedValue({ canceled: true, filePaths: [] });
    await expect(call(Channels.NOTEBASE_NEW_PROJECT_IN_NEW_WINDOW)).resolves.toBeNull();
    expect(h.createWindow).not.toHaveBeenCalled();
  });

  it('NOTEBASE_OPEN_PATH_IN_NEW_WINDOW needs no picker — it opens a known path', async () => {
    expect(call(Channels.NOTEBASE_OPEN_PATH_IN_NEW_WINDOW, '/recent'))
      .toEqual({ rootPath: '/recent', name: 'My Vault' });
    await finishLoad();
    expect(h.openProjectInWindow).toHaveBeenCalledWith(h.freshWin, '/recent');
  });
});

describe('register-notebase — tutorial install (#1542/#1544)', () => {
  it('installs at the confirmed destination and opens it in this window', async () => {
    h.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/home/user/Thoughtbases/Minerva Tutorial' });
    h.installTutorialThoughtbase.mockResolvedValue('/home/user/Thoughtbases/Minerva Tutorial 2');

    await expect(call(Channels.NOTEBASE_INSTALL_TUTORIAL)).resolves.toEqual({
      rootPath: '/home/user/Thoughtbases/Minerva Tutorial 2', name: 'My Vault',
    });
    // The Save panel is pre-filled beside the user's other thoughtbases (#1560).
    expect(h.showSaveDialog).toHaveBeenCalledWith(h.win, expect.objectContaining({
      defaultPath: path.join('/home/user/Thoughtbases', 'Minerva Tutorial'),
    }));
    expect(h.openProjectInWindow).toHaveBeenCalledWith(h.win, '/home/user/Thoughtbases/Minerva Tutorial 2');
  });

  it('creates nothing when the destination panel is cancelled', async () => {
    h.showSaveDialog.mockResolvedValue({ canceled: true });
    await expect(call(Channels.NOTEBASE_INSTALL_TUTORIAL)).resolves.toBeNull();
    expect(h.installTutorialThoughtbase).not.toHaveBeenCalled();
  });

  it('creates nothing when the panel returns no path', async () => {
    h.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '' });
    await expect(call(Channels.NOTEBASE_INSTALL_TUTORIAL)).resolves.toBeNull();
    expect(h.installTutorialThoughtbase).not.toHaveBeenCalled();
  });

  it('the new-window variant leaves the current thoughtbase untouched', async () => {
    h.showSaveDialog.mockResolvedValue({ canceled: false, filePath: '/dest' });
    h.installTutorialThoughtbase.mockResolvedValue('/dest');

    await call(Channels.NOTEBASE_INSTALL_TUTORIAL_IN_NEW_WINDOW);

    // The user's open work stays put: the tutorial lands in a fresh window.
    expect(h.openProjectInWindow).not.toHaveBeenCalledWith(h.win, expect.anything());
    await finishLoad();
    expect(h.openProjectInWindow).toHaveBeenCalledWith(h.freshWin, '/dest');
    expect(h.freshWin.webContents.send).toHaveBeenCalledWith(
      Channels.PROJECT_OPENED, { rootPath: '/dest', name: 'My Vault' },
    );
  });

  it('the new-window variant creates no window when cancelled', async () => {
    h.showSaveDialog.mockResolvedValue({ canceled: true });
    await expect(call(Channels.NOTEBASE_INSTALL_TUTORIAL_IN_NEW_WINDOW)).resolves.toBeNull();
    expect(h.createWindow).not.toHaveBeenCalled();
  });
});

describe('register-notebase — offline caches', () => {
  it('YOUTUBE_THUMBNAIL returns null rather than throwing when offline + uncached', async () => {
    h.getOrFetchThumbnail.mockResolvedValue(null);
    await expect(call(Channels.YOUTUBE_THUMBNAIL, 'abc123')).resolves.toBeNull();
    expect(h.getOrFetchThumbnail).toHaveBeenCalledWith(ROOT, 'abc123');
  });

  it('IMAGES_CACHE_EXTERNAL hands back the cached bytes + mime', async () => {
    h.getOrFetchRemoteImage.mockResolvedValue({ bytes: new Uint8Array([1]), mime: 'image/png' });
    await expect(call(Channels.IMAGES_CACHE_EXTERNAL, 'https://x/y.png')).resolves.toEqual({
      bytes: new Uint8Array([1]), mime: 'image/png',
    });
  });
});
