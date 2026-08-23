/**
 * Local per-note history STORE (#1158). On-disk side of the policy in
 * `policy.ts`. Snapshots live under `.minerva/history/<mirrored-note-path>/` as
 * plain content files (`<ts>.snap`) plus an `index.json` of metadata — plain
 * files so a note's past is inspectable/recoverable even if the app breaks, and
 * under `.minerva/` (already gitignored) so it never touches the user's own git.
 *
 * Uses raw `node:fs` on purpose: it must NOT route through `notebase/fs.ts`
 * (that's where capture is hooked — a snapshot writing through it would recurse)
 * and its files must stay out of the graph/search index (`.minerva` is ignored).
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import {
  exceedsSizeLimit,
  retentionOptions,
  selectForRetention,
  shouldCapture,
  type RevisionMeta,
  type RevisionSource,
} from './policy';
import { getHistorySettings } from './settings';
// A leaf (only `node:fs/promises`), imported directly rather than through the
// `ipc/helpers` barrel so this stays clear of electron.
import { readJsonFileOr } from '../ipc/read-json';
import { emitHistoryChanged } from './history-events';
import type { HistorySettings } from '../../shared/history';

const HISTORY_DIR = '.minerva/history';
const INDEX_FILE = 'index.json';

/** "The file isn't there" — the one absence these reads treat as expected. */
function isENOENT(err: unknown): boolean {
  return (err as NodeJS.ErrnoException | null)?.code === 'ENOENT';
}

/** Absolute dir holding one note's revisions. `relPath` is a project-relative
 *  note path already validated by the caller (capture runs after the write's
 *  own `assertSafePath`). We still refuse an escaping path defensively. */
function noteDir(rootPath: string, relPath: string): string {
  const dir = path.resolve(rootPath, HISTORY_DIR, relPath);
  const base = path.resolve(rootPath, HISTORY_DIR);
  if (dir !== base && !dir.startsWith(base + path.sep)) {
    throw new Error(`history: refusing path outside the history root: ${relPath}`);
  }
  return dir;
}

function snapPath(dir: string, ts: number): string {
  return path.join(dir, `${ts}.snap`);
}

/**
 * A note's revision index. Missing → no history yet, which is the overwhelmingly
 * common case (every note before its first save). Corrupt or unreadable →
 * throws (#1835).
 *
 * It used to catch everything and return `[]`, on the reasoning that a corrupt
 * index shouldn't crash a save. It doesn't have to: the capture hook is
 * best-effort and swallows at its own boundary. What returning `[]` did instead
 * was make a note's entire past *disappear from the panel* while capture
 * cheerfully appended to the file underneath — the note looked new, and the
 * user was never told otherwise. Missing and corrupt are different facts and
 * only one of them is expected.
 */
async function readIndex(dir: string): Promise<RevisionMeta[]> {
  const parsed = await readJsonFileOr<unknown>(path.join(dir, INDEX_FILE), []);
  if (!Array.isArray(parsed)) {
    throw new Error(`history: ${path.join(dir, INDEX_FILE)} is not a list of revisions`);
  }
  return parsed as RevisionMeta[];
}

async function writeIndex(dir: string, entries: RevisionMeta[]): Promise<void> {
  const sorted = [...entries].sort((a, b) => b.ts - a.ts); // newest first
  await fs.writeFile(path.join(dir, INDEX_FILE), JSON.stringify(sorted, null, 2), 'utf-8');
}

/** The most-recent revision's content, or undefined if none — for dedupe.
 *  A snapshot file that has gone missing means "treat the save as changed and
 *  re-capture"; any other read failure is a real problem and throws. */
async function latestContent(dir: string, entries: RevisionMeta[]): Promise<string | undefined> {
  const newest = entries.reduce<RevisionMeta | null>((a, b) => (!a || b.ts > a.ts ? b : a), null);
  if (!newest) return undefined;
  try {
    return await fs.readFile(snapPath(dir, newest.ts), 'utf-8');
  } catch (err) {
    if (isENOENT(err)) return undefined;
    throw err;
  }
}

/**
 * Record `content` as a new revision of `relPath`, unless it's byte-identical to
 * the latest one or the note is over the configured size limit. `source` says
 * how the write came about (origin + the user-facing cause shown in the
 * timeline). Then prune the note's history to the retention window. `now` and
 * `limits` are injectable for tests. No-op (returns null) when nothing was
 * captured; otherwise returns the new revision's metadata.
 */
export async function captureSnapshot(
  rootPath: string,
  relPath: string,
  content: string,
  source: RevisionSource,
  now: number = Date.now(),
  limits?: HistorySettings,
): Promise<RevisionMeta | null> {
  const settings = limits ?? await getHistorySettings();
  if (exceedsSizeLimit(Buffer.byteLength(content, 'utf-8'), settings)) return null;

  const dir = noteDir(rootPath, relPath);
  await fs.mkdir(dir, { recursive: true });
  const entries = await readIndex(dir);

  if (!shouldCapture(content, await latestContent(dir, entries))) return null;

  // Avoid a filename collision if two captures land in the same millisecond.
  let ts = now;
  while (entries.some((e) => e.ts === ts)) ts++;

  const meta: RevisionMeta = {
    ts,
    origin: source.origin,
    ...(source.cause ? { cause: source.cause } : {}),
    // The first revision of a note is its baseline: it's what "restore
    // everything back to the start" restores to, so it's marked (and exempt
    // from pruning) rather than being the first thing retention drops.
    ...(entries.length === 0 ? { initial: true } : {}),
  };
  await fs.writeFile(snapPath(dir, ts), content, 'utf-8');
  entries.push(meta);

  await pruneDir(dir, entries, now, settings);
  // One announcement point for "this note gained a revision", so the renderer
  // never has to poll to notice a save it didn't cause (#1834). Only a real
  // capture emits — an unchanged re-save returns null above.
  emitHistoryChanged(rootPath, relPath);
  return meta;
}

/** Apply the retention rules to one note's index: delete what ages out (or
 *  falls off the per-note cap) and rewrite the index. */
async function pruneDir(
  dir: string,
  entries: RevisionMeta[],
  now: number,
  settings: HistorySettings,
): Promise<{ removed: number }> {
  const { kept, removed } = selectForRetention(entries, now, retentionOptions(settings));
  await Promise.all(
    removed.map((r) => fs.rm(snapPath(dir, r.ts), { force: true })),
  );
  await writeIndex(dir, kept);
  return { removed: removed.length };
}

/**
 * Back-fill the baseline for a note that has no history yet, from whatever is
 * on disk right now — call it BEFORE overwriting the file. Without this, the
 * first save of a note that pre-dates its history (opened from an existing
 * thoughtbase, imported, written by another tool) captures only the *edited*
 * state, and the version the user actually wants back — the one before they
 * touched it — is gone.
 *
 * No-ops when the note already has revisions, or when there's nothing on disk
 * yet (a brand-new file: the write that follows becomes the baseline itself).
 * The revision is stamped with the file's mtime, not `now`, so the timeline
 * says when the note actually last changed.
 */
export async function ensureInitialRevision(
  rootPath: string,
  relPath: string,
  now: number = Date.now(),
): Promise<RevisionMeta | null> {
  // noteDir() re-validates `relPath` (it throws on anything that escapes the
  // history root), so it runs before we resolve the note path to read it.
  const dir = noteDir(rootPath, relPath);
  if ((await readIndex(dir)).length > 0) return null;

  const filePath = path.resolve(rootPath, relPath);
  const settings = await getHistorySettings();
  let content: string;
  let mtimeMs: number;
  try {
    // stat first: an over-limit file is skipped WITHOUT reading it, so the size
    // limit also caps the memory a huge note can cost us.
    const stat = await fs.stat(filePath);
    if (exceedsSizeLimit(stat.size, settings)) return null;
    mtimeMs = stat.mtimeMs;
    content = await fs.readFile(filePath, 'utf-8');
  } catch {
    return null; // nothing on disk to preserve
  }
  // Strictly before the write that's about to land, even if the mtime is in
  // the future (clock skew, a copied file), so the timeline stays ordered.
  const ts = Math.min(Math.floor(mtimeMs), now - 1);
  return captureSnapshot(rootPath, relPath, content, { origin: 'edit', cause: 'Initial version' }, ts, settings);
}

/** A note's revisions, newest first (metadata only — no content). */
export async function listRevisions(rootPath: string, relPath: string): Promise<RevisionMeta[]> {
  const entries = await readIndex(noteDir(rootPath, relPath));
  return entries.sort((a, b) => b.ts - a.ts);
}

/**
 * The content of one revision, or `null` when there is no such revision — and
 * ONLY that (#1835). A read that fails for any other reason (permissions, a
 * truncated volume) throws, rather than telling the caller the revision was
 * never there; `HISTORY_RESTORE` turns that `null` into "revision not found",
 * and it should mean it.
 */
export async function getRevisionContent(rootPath: string, relPath: string, ts: number): Promise<string | null> {
  try {
    return await fs.readFile(snapPath(noteDir(rootPath, relPath), ts), 'utf-8');
  } catch (err) {
    if (isENOENT(err)) return null;
    throw err;
  }
}

/** Move a note's history when the note is renamed/moved, so its past follows
 *  it. Silent no-op when the source has no history. */
export async function moveHistory(rootPath: string, oldRel: string, newRel: string): Promise<void> {
  const from = noteDir(rootPath, oldRel);
  const to = noteDir(rootPath, newRel);
  try {
    await fs.access(from);
  } catch {
    return; // nothing to move
  }
  await fs.mkdir(path.dirname(to), { recursive: true });
  await fs.rm(to, { recursive: true, force: true }); // clear any stale dest
  await fs.rename(from, to);
}

/** Set (or clear, with undefined) a revision's label — version tagging.
 *  Labeled revisions are exempt from pruning. */
export async function setRevisionLabel(
  rootPath: string,
  relPath: string,
  ts: number,
  label: string | undefined,
): Promise<void> {
  const dir = noteDir(rootPath, relPath);
  const entries = await readIndex(dir);
  const entry = entries.find((e) => e.ts === ts);
  if (!entry) return;
  if (label) entry.label = label;
  else delete entry.label;
  await writeIndex(dir, entries);
  emitHistoryChanged(rootPath, relPath);
}

/**
 * Label the version of `relPath` the user is looking at right now — the
 * "Label version…" action from the History panel's note list.
 *
 * The label has to name the CURRENT content, so if the note's newest revision
 * doesn't match what's on disk (a note edited outside the app since its last
 * capture), the current state is captured first and the label goes on that.
 * Otherwise the label would quietly point at stale text — the one thing a
 * restore point must never do.
 *
 * Returns the labeled revision.
 */
export async function labelCurrentVersion(
  rootPath: string,
  relPath: string,
  label: string,
  now: number = Date.now(),
): Promise<RevisionMeta> {
  await ensureInitialRevision(rootPath, relPath, now);

  const dir = noteDir(rootPath, relPath);
  const content = await fs.readFile(path.resolve(rootPath, relPath), 'utf-8');
  // `captureSnapshot` dedupes against the newest revision, so this is a no-op
  // when the note is already captured as-is, and a real capture when it isn't.
  const captured = await captureSnapshot(
    rootPath,
    relPath,
    content,
    { origin: 'edit', cause: 'External change' },
    now,
  );

  const entries = await readIndex(dir);
  const newest = captured ?? entries.reduce<RevisionMeta | null>((a, b) => (!a || b.ts > a.ts ? b : a), null);
  if (!newest) throw new Error(`history: no revision to label for "${relPath}"`);

  await setRevisionLabel(rootPath, relPath, newest.ts, label);
  return { ...newest, label };
}

/**
 * Re-apply the retention rules across a whole project's history — run after the
 * limits change, so lowering them frees disk NOW rather than note-by-note as
 * each one happens to be edited again. Best-effort per note: a corrupt index
 * for one note doesn't stop the sweep. Returns what it dropped.
 */
export async function pruneAllHistory(
  rootPath: string,
  now: number = Date.now(),
  limits?: HistorySettings,
): Promise<{ notes: number; removed: number }> {
  const settings = limits ?? await getHistorySettings();
  const base = path.resolve(rootPath, HISTORY_DIR);
  let notes = 0;
  let removed = 0;

  const walk = async (dir: string): Promise<void> => {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return; // no history yet, or unreadable — nothing to prune
    }
    // A note's history dir is the one holding an index.json. Dirs nest to
    // mirror note paths, and a note path can itself be a prefix of another
    // (`a.md/` next to `a.md.bak/`), so recurse regardless.
    if (entries.some((e) => e.isFile() && e.name === INDEX_FILE)) {
      notes++;
      try {
        const index = await readIndex(dir);
        removed += (await pruneDir(dir, index, now, settings)).removed;
      } catch (err) {
        console.warn(`[history] prune skipped "${dir}":`, err);
      }
    }
    for (const e of entries) {
      if (e.isDirectory()) await walk(path.join(dir, e.name));
    }
  };

  await walk(base);
  // A sweep touches many notes at once; `null` says "refresh whatever you're
  // showing" rather than making the renderer diff a list of paths.
  if (removed > 0) emitHistoryChanged(rootPath, null);
  return { notes, removed };
}
