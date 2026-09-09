/**
 * Behavioral net for `resolveDroppedEntries` (#2087, PR 2/2) — the renderer
 * walk that resolves a drag-and-drop `DataTransfer`'s `FileSystemEntry` tree
 * into a flat `DropImportEntry[]` for `dropImport`. Hand-builds fake
 * `DataTransferItem`/`FileSystemFileEntry`/`FileSystemDirectoryEntry`
 * objects implementing only the methods/properties this code calls, rather
 * than depending on jsdom (which doesn't model the File and Directory
 * Entries API at all).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  api: { files: { getPathForFile: vi.fn() } },
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));

import { resolveDroppedEntries } from '../../../src/renderer/lib/app/dropped-entries';

function makeFile(name: string): File {
  return new File(['content'], name);
}

function makeFileEntry(name: string): FileSystemFileEntry {
  return {
    name,
    isFile: true,
    isDirectory: false,
    file: (success: (file: File) => void) => success(makeFile(name)),
  } as unknown as FileSystemFileEntry;
}

/** `batches` is the sequence of arrays `readEntries` should hand back across
 *  successive calls — the last batch MUST be `[]` to terminate the walk,
 *  mirroring `FileSystemDirectoryReader`'s real "call until empty" contract. */
function makeDirEntry(name: string, batches: FileSystemEntry[][]): FileSystemDirectoryEntry {
  let callIndex = 0;
  return {
    name,
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (success: (entries: FileSystemEntry[]) => void) => {
        const batch = batches[callIndex] ?? [];
        callIndex++;
        success(batch);
      },
    }),
  } as unknown as FileSystemDirectoryEntry;
}

function makeDataTransfer(entries: Array<FileSystemEntry | null>): DataTransfer {
  return {
    items: entries.map((entry) => ({ webkitGetAsEntry: () => entry })),
  } as unknown as DataTransfer;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.api.files.getPathForFile.mockImplementation((f: File) => `/abs/${f.name}`);
});

describe('resolveDroppedEntries', () => {
  it('resolves a flat file item with no relativePath', async () => {
    const dt = makeDataTransfer([makeFileEntry('note.md')]);
    const result = await resolveDroppedEntries(dt);
    expect(result).toEqual([{ localPath: '/abs/note.md' }]);
  });

  it('resolves a directory recursively, prefixing relativePath with the top-level folder name', async () => {
    const subDir = makeDirEntry('sub', [[makeFileEntry('file.md')], []]);
    const topDir = makeDirEntry('TopFolder', [[subDir], []]);
    const dt = makeDataTransfer([topDir]);
    const result = await resolveDroppedEntries(dt);
    expect(result).toEqual([
      { localPath: '/abs/file.md', relativePath: 'TopFolder/sub/file.md' },
    ]);
  });

  it('captures every entry across multiple readEntries batches, not just the first', async () => {
    const dir = makeDirEntry('Many', [
      [makeFileEntry('a.md')],
      [makeFileEntry('b.md')],
      [],
    ]);
    const dt = makeDataTransfer([dir]);
    const result = await resolveDroppedEntries(dt);
    expect(result).toEqual(
      expect.arrayContaining([
        { localPath: '/abs/a.md', relativePath: 'Many/a.md' },
        { localPath: '/abs/b.md', relativePath: 'Many/b.md' },
      ]),
    );
    expect(result).toHaveLength(2);
  });

  it('skips an item whose webkitGetAsEntry() returns null without throwing', async () => {
    const dt = makeDataTransfer([null, makeFileEntry('ok.md')]);
    const result = await resolveDroppedEntries(dt);
    expect(result).toEqual([{ localPath: '/abs/ok.md' }]);
  });

  it('excludes a nested .git directory and its contents', async () => {
    const gitDir = makeDirEntry('.git', [[makeFileEntry('HEAD')], []]);
    const topDir = makeDirEntry('Repo', [[gitDir, makeFileEntry('readme.md')], []]);
    const dt = makeDataTransfer([topDir]);
    const result = await resolveDroppedEntries(dt);
    expect(result).toEqual([
      { localPath: '/abs/readme.md', relativePath: 'Repo/readme.md' },
    ]);
  });

  it('excludes a nested node_modules directory and its contents', async () => {
    const nodeModules = makeDirEntry('node_modules', [[makeFileEntry('pkg.md')], []]);
    const topDir = makeDirEntry('Project', [[nodeModules, makeFileEntry('index.md')], []]);
    const dt = makeDataTransfer([topDir]);
    const result = await resolveDroppedEntries(dt);
    expect(result).toEqual([
      { localPath: '/abs/index.md', relativePath: 'Project/index.md' },
    ]);
  });

  it('does NOT exclude a top-level dropped folder whose own name starts with a dot', async () => {
    // Mirrors enumerateFolderTree's exact semantic (src/main/notebase/
    // folder-walk.ts): only entries discovered while RECURSING are checked
    // against the ignored-entry predicate — the top-level dropped item never
    // is. A dot-prefixed folder picked via the existing picker flow already
    // works; a dropped one must behave identically.
    const dotDir = makeDirEntry('.research-notes', [[makeFileEntry('idea.md')], []]);
    const dt = makeDataTransfer([dotDir]);
    const result = await resolveDroppedEntries(dt);
    expect(result).toEqual([
      { localPath: '/abs/idea.md', relativePath: '.research-notes/idea.md' },
    ]);
  });

  it('does NOT exclude a top-level dropped file whose own name starts with a dot', async () => {
    const dt = makeDataTransfer([makeFileEntry('.env')]);
    const result = await resolveDroppedEntries(dt);
    expect(result).toEqual([{ localPath: '/abs/.env' }]);
  });

  it('skips a resolved file when getPathForFile returns falsy', async () => {
    h.api.files.getPathForFile.mockReturnValue('');
    const dt = makeDataTransfer([makeFileEntry('ghost.md')]);
    const result = await resolveDroppedEntries(dt);
    expect(result).toEqual([]);
  });

  it('concatenates results across multiple top-level items (mixed files and folders)', async () => {
    const dir = makeDirEntry('Folder', [[makeFileEntry('inner.md')], []]);
    const dt = makeDataTransfer([makeFileEntry('flat.md'), dir]);
    const result = await resolveDroppedEntries(dt);
    expect(result).toEqual([
      { localPath: '/abs/flat.md' },
      { localPath: '/abs/inner.md', relativePath: 'Folder/inner.md' },
    ]);
  });
});
