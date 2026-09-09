/**
 * Resolve a drag-and-drop `DataTransfer` payload into a flat list of
 * `DropImportEntry` for `dropImport` (#2087, PR 2/2).
 *
 * PR 1 (#2124/#2125) added zip/folder-picker ingestion via a menu command,
 * but a dropped folder never resolved — the renderer only ever collected
 * flat `File` objects off `dataTransfer.files`, which has no notion of a
 * folder's contents. A dropped `.zip` already worked, since it's a
 * resolvable leaf `File` that PR 1's `dropImport` dispatch extracts. This
 * file walks the drop's `FileSystemEntry` tree (the non-standard but
 * universally-supported `webkitGetAsEntry` API) to recursively discover
 * files inside dropped folders, matching what `enumerateFolderTree`
 * (`src/main/notebase/folder-walk.ts`) does for the picker path.
 *
 * CRITICAL ORDERING REQUIREMENT — read before touching this file:
 * `DataTransferItemList` (`dataTransfer.items`) becomes inaccessible once the
 * triggering event handler yields to the event loop — this is a browser
 * security measure, not a bug. Every `item.webkitGetAsEntry()` call MUST
 * happen synchronously, as literally the first statement of
 * `resolveDroppedEntries`, before any `await`. The subsequent recursive
 * directory walk on the already-captured `FileSystemEntry` objects can
 * safely be async — entries themselves don't expire, only the *list you read
 * them from* does. A future refactor that adds an `await` before that
 * capture loop would silently break drag-and-drop with NO test able to catch
 * it — jsdom's fake `DataTransfer` doesn't model item-list invalidation, so
 * this comment is the only guard against that regression.
 */
import { api } from '../ipc/client';
import type { DropImportEntry } from '../ipc/client';

/**
 * Local copy of `isIgnoredEntry` / `IGNORED_DIRS` from
 * `src/main/notebase/ignored-dirs.ts` — the renderer never imports from
 * `src/main` (hard process-boundary convention; see `src/renderer/lib/ipc/
 * client.ts`'s cross-reference to `src/main/notebase/folder-walk.ts` for the
 * same pattern). Keep these two predicates in sync by hand.
 */
const IGNORED_DIRS: ReadonlySet<string> = new Set(['.git', 'node_modules', '.minerva', '.obsidian']);
function isIgnoredEntry(name: string): boolean {
  return name.startsWith('.') || IGNORED_DIRS.has(name);
}

/**
 * `FileSystemDirectoryReader.readEntries` is documented to NOT necessarily
 * return a directory's full contents in one call — callers must keep calling
 * it until it returns an empty array. Collects every batch into one flat
 * list.
 */
function readAllEntries(reader: FileSystemDirectoryReader): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => {
    const all: FileSystemEntry[] = [];
    const readNextBatch = () => {
      reader.readEntries((batch) => {
        if (batch.length === 0) {
          resolve(all);
          return;
        }
        all.push(...batch);
        readNextBatch();
      }, reject);
    };
    readNextBatch();
  });
}

function readEntryFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

async function resolveFileEntry(
  entry: FileSystemFileEntry,
  relativePath: string | undefined,
): Promise<DropImportEntry | undefined> {
  const file = await readEntryFile(entry);
  // Electron 32+: `webUtils.getPathForFile` is the supported accessor;
  // `File.path` was deprecated and is removed in Electron 34.
  const localPath = api.files.getPathForFile(file);
  if (!localPath) return undefined;
  return relativePath ? { localPath, relativePath } : { localPath };
}

/**
 * Recursively walk a directory entry's contents. Mirrors
 * `enumerateFolderTree`'s exact filtering placement: `dirEntry` itself is
 * never checked against `isIgnoredEntry` here — only entries discovered
 * while reading its contents are (the top-level check is the caller's job,
 * and per spec it deliberately never happens — see `resolveDroppedEntries`).
 * `prefix` is the POSIX relative path of `dirEntry` itself (starting with
 * the top-level dropped folder's own name), so a child gets
 * `${prefix}/${child.name}`.
 */
async function walkDirectory(dirEntry: FileSystemDirectoryEntry, prefix: string): Promise<DropImportEntry[]> {
  const children = await readAllEntries(dirEntry.createReader());
  const out: DropImportEntry[] = [];
  for (const child of children) {
    if (isIgnoredEntry(child.name)) continue;
    const childPath = `${prefix}/${child.name}`;
    if (child.isDirectory) {
      out.push(...await walkDirectory(child as FileSystemDirectoryEntry, childPath));
    } else if (child.isFile) {
      const resolved = await resolveFileEntry(child as FileSystemFileEntry, childPath);
      if (resolved) out.push(resolved);
    }
  }
  return out;
}

/**
 * Resolve every top-level item in a drop's `DataTransfer` into a flat
 * `DropImportEntry[]`, recursing into any dropped folders. A drop can carry
 * multiple top-level items (some files, some folders) — each is processed
 * independently and the results are concatenated.
 *
 * A flat dropped file (or `.zip` — PR 1's dispatch already handles
 * extraction) resolves to `{localPath}` with no `relativePath`, matching
 * today's contract for a bare file drop. A dropped folder's files get
 * `relativePath` values prefixed with the folder's own name (matching
 * `DropImportEntry`'s documented contract). Note the top-level dropped item
 * itself — file or folder — is NEVER checked against `isIgnoredEntry`, only
 * children discovered while recursing into a folder are; this mirrors
 * `enumerateFolderTree`, which never validates its own `rootDir` argument,
 * so a user can drop (or pick) a dot-prefixed folder and have it work.
 */
export async function resolveDroppedEntries(dataTransfer: DataTransfer): Promise<DropImportEntry[]> {
  // MUST be synchronous, before any `await` in this function — see the
  // header comment on why the item list can't survive to the next tick.
  const topLevelEntries = Array.from(dataTransfer.items, (item) => item.webkitGetAsEntry());

  const out: DropImportEntry[] = [];
  for (const entry of topLevelEntries) {
    if (!entry) continue; // webkitGetAsEntry() can return null (e.g. a non-file drag payload).
    if (entry.isDirectory) {
      out.push(...await walkDirectory(entry as FileSystemDirectoryEntry, entry.name));
    } else if (entry.isFile) {
      const resolved = await resolveFileEntry(entry as FileSystemFileEntry, undefined);
      if (resolved) out.push(resolved);
    }
  }
  return out;
}
