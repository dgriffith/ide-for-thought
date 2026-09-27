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

/**
 * Containment guard for every thoughtbase file operation. Returns the
 * absolute path to hand to `fs.*`, or throws `Path traversal detected`.
 *
 * THREAT MODEL (#2357). The thoughtbase directory is NOT trusted content:
 * it arrives by zip import, git clone and folder sync, and its relative
 * paths reach this function from the renderer and from LLM tools
 * (`read_note`, `fetch_properties`, …) whose arguments a prompt injection
 * can choose. So the guarantee is about where the bytes actually live, not
 * about how the path is spelled: **no path accepted here reads or writes
 * outside the realpath of the root.** Two ways out are closed:
 *
 *   1. Lexical escape — `../x`, an absolute path. Caught by resolving
 *      against the realpath'd root and checking the prefix.
 *   2. Symlink escape — `notes/link → ~/.ssh`, then `notes/link/id_rsa`.
 *      Lexically inside, but `fs.readFile`/`writeFile` follow the link.
 *      Caught by `assertNoSymlinkEscape`, which canonicalises the part of
 *      the path that exists and re-checks the prefix. A dangling link is
 *      resolved by hand, because a write FOLLOWS a dangling link and
 *      creates its target.
 *
 * Symlinks that stay inside the root keep working, and the root itself may
 * be a symlink (#352: macOS's /var → /private/var, where tmpdir() lives) —
 * both are the realpath'd-root case. An escaping symlink is refused in
 * every operation, including rename/delete of the link itself: deleting
 * one is left to Finder rather than special-cased here.
 *
 * NOT covered: a race where a component is swapped for a symlink between
 * this check and the `fs.*` call (TOCTOU). Closing that needs
 * `O_NOFOLLOW`/`openat`-style descriptor walking, which Node doesn't
 * expose; the attacker would need live write access to the thoughtbase
 * while the app runs, which is outside this model.
 *
 * The return value is the lexical resolution against the realpath'd root
 * (for an in-root symlink it still names the path THROUGH the link), same
 * as before #2357, so callers' path arithmetic is unchanged.
 */
export function assertSafePath(rootPath: string, relativePath: string): string {
  const root = realRoot(rootPath);
  const resolved = path.resolve(root, relativePath);
  if (!isWithin(root, resolved)) {
    throw new Error('Path traversal detected');
  }
  assertNoSymlinkEscape(root, resolved);
  return resolved;
}

function isWithin(root: string, p: string): boolean {
  return p === root || p.startsWith(root + path.sep);
}

/**
 * Walk `resolved` down from the (canonical) root with one `lstat` per
 * component, and only if a component turns out to be a symlink pay for a
 * full canonicalisation. `assertSafePath` is hot — every file IPC, several
 * inside loops — and measured on macOS an `lstat` is ~1.2us against ~13us
 * for `realpath`, so the common no-symlink case costs ~1us per path segment
 * below the root and never calls `realpathSync` (which keeps #2216's
 * "one realpath per root" property intact).
 *
 * The walk stops at the first component that doesn't exist: nothing below
 * it can be a link, which is what makes write-to-create (leaf and any
 * intermediate dirs missing) work. Any other `lstat` failure (ENOTDIR,
 * EACCES) also stops it — the `fs.*` call can't get past that component
 * either, so there is nothing further for it to follow.
 */
function assertNoSymlinkEscape(root: string, resolved: string): void {
  if (resolved === root) return;
  const parts = resolved.slice(root.length + 1).split(path.sep);
  let cur = root;
  for (let i = 0; i < parts.length; i++) {
    cur = cur + path.sep + parts[i];
    let st: fsSync.Stats | undefined;
    try {
      st = fsSync.lstatSync(cur, { throwIfNoEntry: false });
    } catch {
      return;
    }
    if (st === undefined) return;
    if (st.isSymbolicLink()) {
      // Everything from here down is resolved in one go: canonicalise the
      // whole remaining path (chains, links-to-links, dangling links) and
      // check where it really lands.
      if (!isWithin(root, canonicalizeExisting(resolved))) {
        throw new Error('Path traversal detected');
      }
      return;
    }
  }
}

/** Linux's MAXSYMLINKS; a chain longer than this is a loop (or hostile). */
const MAX_SYMLINK_HOPS = 40;

/**
 * `realpath` for a path whose tail may not exist: canonicalise the deepest
 * existing ancestor and re-append the missing components. If the first
 * missing component is itself a (dangling) symlink, follow it by hand —
 * `fs.writeFile` on a dangling link creates the link's TARGET, so its
 * target is where a write would land. Only reached when a symlink is
 * actually on the path, so its cost is off the hot path.
 */
function canonicalizeExisting(abs: string, hops = 0): string {
  if (hops > MAX_SYMLINK_HOPS) {
    // Can't prove where it lands; the fs call would ELOOP anyway.
    throw new Error('Path traversal detected');
  }
  const tail: string[] = [];
  let existing = abs;
  for (;;) {
    let real: string;
    try {
      real = fsSync.realpathSync(existing);
    } catch {
      const parent = path.dirname(existing);
      if (parent === existing) return abs;
      tail.unshift(path.basename(existing));
      existing = parent;
      continue;
    }
    if (tail.length === 0) return real;
    const next = path.join(real, tail[0]!);
    let st: fsSync.Stats | undefined;
    try {
      st = fsSync.lstatSync(next, { throwIfNoEntry: false });
    } catch {
      st = undefined;
    }
    if (st?.isSymbolicLink()) {
      const target = path.resolve(real, fsSync.readlinkSync(next));
      return canonicalizeExisting(path.join(target, ...tail.slice(1)), hops + 1);
    }
    return path.join(real, ...tail);
  }
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
