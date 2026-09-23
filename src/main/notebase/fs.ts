import { dialog } from 'electron';
import fs from 'node:fs/promises';
import fsSync from 'node:fs';
import path from 'node:path';
import type { NoteFile, NotebaseMeta } from '../../shared/types';
import { resolveDisplayName } from '../project-config';
import { defaultThoughtbaseDir } from '../recent-projects';
import { onNoteWriting, onNoteWritten, onNoteDeleting, onNoteDeleted, moveHistory, runWithHistorySource } from '../history';
import { isIgnoredEntry } from '../../shared/ignored-dirs';
import { isNotePath } from '../../shared/note-extensions';

export async function openNotebase(): Promise<NotebaseMeta | null> {
  const result = await dialog.showOpenDialog({
    // `createDirectory` (macOS) adds a New Folder button so the user can make a
    // fresh directory to open as a thoughtbase without leaving the app (#1036).
    properties: ['openDirectory', 'createDirectory'],
    title: 'Open Thoughtbase',
    defaultPath: defaultThoughtbaseDir(),
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  const rootPath = result.filePaths[0]!;
  return {
    rootPath,
    name: resolveDisplayName(rootPath),
  };
}

export async function listFiles(rootPath: string): Promise<NoteFile[]> {
  return readDirectory(rootPath, rootPath);
}

async function readDirectory(dirPath: string, rootPath: string): Promise<NoteFile[]> {
  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  const files: NoteFile[] = [];

  for (const entry of entries) {
    if (isIgnoredEntry(entry.name)) continue;

    const fullPath = path.join(dirPath, entry.name);
    const relativePath = path.relative(rootPath, fullPath);

    if (entry.isDirectory()) {
      const children = await readDirectory(fullPath, rootPath);
      files.push({
        name: entry.name,
        relativePath,
        isDirectory: true,
        children,
      });
    } else {
      // List every file, not just indexable ones (#1130) — hiding unknown
      // extensions made files a user put in their project silently vanish.
      // Indexing stays gated on INDEXABLE_EXTS elsewhere; listing ≠ indexing.
      // mtime drives the "2h / 5d / 1mo" stamp on each file row in the
      // sidebar (§5.3 of the 2026-05 design review). One extra stat per
      // file at listing time; for typical thoughtbase sizes this is
      // dwarfed by the existing graph indexing.
      let mtimeMs: number | undefined;
      try {
        mtimeMs = (await fs.stat(fullPath)).mtimeMs;
      } catch {
        // Race against deletion or a transient permission glitch — drop
        // the stamp rather than fail the whole listing.
      }
      files.push({
        name: entry.name,
        relativePath,
        isDirectory: false,
        ...(mtimeMs !== undefined ? { mtimeMs } : {}),
      });
    }
  }

  files.sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name);
  });

  return files;
}

/**
 * Best-effort realpath: returns the canonicalised path when the prefix
 * exists, falling back to the input when it doesn't (so projects can
 * still be checked before they're created).
 */
function realPathSafe(p: string): string {
  try {
    return fsSync.realpathSync(p);
  } catch {
    return p;
  }
}

/**
 * Memo for `realPathSafe(rootPath)` (#2216).
 *
 * `assertSafePath` runs on every file IPC — 24 call sites, several inside
 * loops — and boot walks the whole project three to four times. The syscall
 * dominates: measured at 16.25us against 17.22us for the whole of
 * `assertSafePath`, i.e. **94% of the guard's cost is canonicalising a path
 * that cannot change**. At 2,000 notes that is ~34ms per full pass, paid
 * several times over before the window paints, and again on every save.
 *
 * Deliberately a small fixed-size ring rather than a `Map` keyed by rootPath,
 * for two reasons that pull the same way:
 *
 *   - `assertSafePath` is called for roots that are NOT open projects — the
 *     comment below notes it must work before a project exists — so a
 *     per-project slot would be allocated by a read. #2240 is explicit that a
 *     read must not allocate a slot, having been bitten by exactly that.
 *   - A rootPath-keyed collection is per-project state and owes someone a
 *     teardown (`tests/architecture/project-state-registered.test.ts`). This
 *     owes nobody anything: it is bounded, it self-evicts, and dropping an
 *     entry costs one syscall.
 *
 * Four entries covers several windows open on different projects; beyond that
 * it degrades to today's behaviour rather than to a wrong answer.
 *
 * SOUNDNESS: the cached value is the canonical path of the project root. It
 * goes stale only if the root itself is replaced by a different directory or
 * symlink while the app holds it open — at which point the user has swapped
 * the thoughtbase under a running editor, and a stale realpath is the least
 * of it. The traversal check this feeds is about a RELATIVE path escaping the
 * root, and that check is unchanged.
 */
const REAL_ROOT_CACHE_SIZE = 4;
const realRootCache: Array<{ root: string; real: string }> = [];

function realRoot(rootPath: string): string {
  const hit = realRootCache.find((e) => e.root === rootPath);
  if (hit) return hit.real;
  const real = realPathSafe(rootPath);
  realRootCache.unshift({ root: rootPath, real });
  if (realRootCache.length > REAL_ROOT_CACHE_SIZE) realRootCache.pop();
  return real;
}

/** Drop the memo. Exported for tests that move a root between symlink
 *  endpoints; production never needs it. */
export function _clearRealRootCacheForTests(): void {
  realRootCache.length = 0;
}

export function assertSafePath(rootPath: string, relativePath: string): string {
  // realpath the rootPath so a project rooted on a symlinked path —
  // notably macOS's /var → /private/var, which is where tmpdir() lives
  // (#352) — doesn't make a normal in-project relative path look like
  // a traversal. We resolve `relativePath` *against* the realpath'd
  // root (rather than realpath'ing each result) because the leaf or
  // any intermediate dir may not exist yet (write-to-create), and
  // resolve doesn't follow symlinks anyway, so this canonical-prefix
  // form is enough to make the startsWith check sound.
  const root = realRoot(rootPath);
  const resolved = path.resolve(root, relativePath);
  if (!resolved.startsWith(root + path.sep) && resolved !== root) {
    throw new Error('Path traversal detected');
  }
  // Return the realpath-anchored resolution: it's always usable by
  // fs.* and won't drift between symlink endpoints in subsequent ops.
  return resolved;
}

export async function readFile(rootPath: string, relativePath: string): Promise<string> {
  const fullPath = assertSafePath(rootPath, relativePath);
  return fs.readFile(fullPath, 'utf-8');
}

/**
 * Binary-safe read for images / pdfs / other non-text assets the
 * renderer needs to display inline (#244 image rendering, #243 image
 * cell outputs persisted as sidecar files). Returns the raw bytes;
 * the caller decides how to encode (base64 + data URL is typical).
 *
 * Same path-traversal guard as `readFile`: out-of-root reads throw.
 */
export async function readBinaryFile(rootPath: string, relativePath: string): Promise<Uint8Array> {
  const fullPath = assertSafePath(rootPath, relativePath);
  const buf = await fs.readFile(fullPath);
  return new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength);
}

/**
 * Binary-safe write — pair to `readBinaryFile`. Used for image upload
 * via drag-and-drop / paste in the editor (#455). Same path-traversal
 * guard as `writeFile`; creates parent directories on demand.
 */
export async function writeBinaryFile(
  rootPath: string,
  relativePath: string,
  bytes: Uint8Array,
): Promise<void> {
  const fullPath = assertSafePath(rootPath, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, bytes);
}

/**
 * True iff `relativePath` resolves to an existing file. Used by the
 * asset-upload path to skip rewriting an asset that's already on
 * disk under the same content-hashed name (#455).
 */
export async function fileExists(rootPath: string, relativePath: string): Promise<boolean> {
  const fullPath = assertSafePath(rootPath, relativePath);
  try {
    const stat = await fs.stat(fullPath);
    return stat.isFile();
  } catch {
    return false;
  }
}

export async function writeFile(rootPath: string, relativePath: string, content: string): Promise<void> {
  const fullPath = assertSafePath(rootPath, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  // Before clobbering: give a note that has no history yet a baseline revision
  // from what's on disk, so the pre-edit state of a note that pre-dates its
  // history is still recoverable (#1158).
  await onNoteWriting(rootPath, relativePath);
  await fs.writeFile(fullPath, content, 'utf-8');
  // Record the saved state in local per-note history (#1158). Best-effort — the
  // hook swallows its own errors so a history failure can't fail the save.
  //
  // Awaited on purpose, and it was worth re-deciding (#1836). Since the hook
  // can't fail the save, the await buys no error handling — but it does buy
  // ORDERING. Capture is read-modify-write on a shared `index.json`; drop the
  // await and two rapid saves of the same note can interleave their
  // read-index / write-index, losing one revision's metadata and orphaning its
  // snapshot. There is no per-note write queue in main to lean on (that
  // absence is what made #1833 a bug), so the await IS the serialization.
  // Making this fire-and-forget needs that queue first; the cost was taken out
  // of the work instead — see the settings cache and the hash-based dedupe.
  await onNoteWritten(rootPath, relativePath, content);
}

export async function createFile(rootPath: string, relativePath: string): Promise<void> {
  const fullPath = assertSafePath(rootPath, relativePath);
  await fs.mkdir(path.dirname(fullPath), { recursive: true });
  await fs.writeFile(fullPath, '', 'utf-8');
  // A new note starts with an empty baseline in its history, so "back to the
  // beginning" is a real destination from the very first edit.
  await runWithHistorySource({ origin: 'edit', cause: 'Initial version' }, () =>
    onNoteWritten(rootPath, relativePath, ''));
}

export async function deleteFile(rootPath: string, relativePath: string): Promise<void> {
  const fullPath = assertSafePath(rootPath, relativePath);
  // Capture the final state before it's gone, then mark the deletion in
  // local history (#2089) — best-effort hooks, same shape as writeFile's
  // onNoteWriting/onNoteWritten pair.
  await onNoteDeleting(rootPath, relativePath);
  await fs.unlink(fullPath);
  await onNoteDeleted(rootPath, relativePath);
}

export async function createFolder(rootPath: string, relativePath: string): Promise<void> {
  const fullPath = assertSafePath(rootPath, relativePath);
  await fs.mkdir(fullPath, { recursive: true });
}

/** Every note file (per `isNotePath`) under `relDir`, recursively — relative
 *  to `rootPath`. Mirrors `readDirectory`'s walk shape, filtered to notes
 *  only; used by `deleteFolder` to capture each note's final state before the
 *  whole subtree disappears in one `fs.rm` (#2089). */
async function listNoteFilesUnder(rootPath: string, relDir: string): Promise<string[]> {
  const out: string[] = [];
  const walk = async (dir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (isIgnoredEntry(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
      } else {
        const rel = path.relative(rootPath, full);
        if (isNotePath(rel)) out.push(rel);
      }
    }
  };
  await walk(path.resolve(rootPath, relDir));
  return out;
}

export async function deleteFolder(rootPath: string, relativePath: string): Promise<void> {
  const fullPath = assertSafePath(rootPath, relativePath);
  // Sequential, not Promise.all (matches pruneAllHistory's style) — capture
  // every note's final state before the recursive rm removes them all at
  // once, then mark each one deleted (#2089).
  const noteFiles = await listNoteFilesUnder(rootPath, relativePath);
  for (const relPath of noteFiles) await onNoteDeleting(rootPath, relPath);
  await fs.rm(fullPath, { recursive: true });
  for (const relPath of noteFiles) await onNoteDeleted(rootPath, relPath);
}

export async function rename(rootPath: string, oldRelPath: string, newRelPath: string): Promise<void> {
  const oldFull = assertSafePath(rootPath, oldRelPath);
  const newFull = assertSafePath(rootPath, newRelPath);
  await fs.mkdir(path.dirname(newFull), { recursive: true });
  await fs.rename(oldFull, newFull);
  // Local history mirrors the note path, so one move relocates a single note's
  // revisions OR (path-parallel) every note under a renamed folder (#1158).
  await moveHistory(rootPath, oldRelPath, newRelPath);
}

export async function copyItem(rootPath: string, srcRelPath: string, destRelPath: string): Promise<void> {
  const srcFull = assertSafePath(rootPath, srcRelPath);
  const destFull = assertSafePath(rootPath, destRelPath);
  await fs.mkdir(path.dirname(destFull), { recursive: true });
  await fs.cp(srcFull, destFull, { recursive: true });
}
