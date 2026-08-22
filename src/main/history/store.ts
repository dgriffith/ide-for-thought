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
  selectForRetention,
  shouldCapture,
  type RevisionMeta,
  type RevisionSource,
} from './policy';

const HISTORY_DIR = '.minerva/history';
const INDEX_FILE = 'index.json';

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

async function readIndex(dir: string): Promise<RevisionMeta[]> {
  try {
    const raw = await fs.readFile(path.join(dir, INDEX_FILE), 'utf-8');
    const parsed = JSON.parse(raw) as unknown;
    // A corrupt index shouldn't crash a save; treat it as "no history yet".
    return Array.isArray(parsed) ? (parsed as RevisionMeta[]) : [];
  } catch {
    return [];
  }
}

async function writeIndex(dir: string, entries: RevisionMeta[]): Promise<void> {
  const sorted = [...entries].sort((a, b) => b.ts - a.ts); // newest first
  await fs.writeFile(path.join(dir, INDEX_FILE), JSON.stringify(sorted, null, 2), 'utf-8');
}

/** The most-recent revision's content, or undefined if none — for dedupe. */
async function latestContent(dir: string, entries: RevisionMeta[]): Promise<string | undefined> {
  const newest = entries.reduce<RevisionMeta | null>((a, b) => (!a || b.ts > a.ts ? b : a), null);
  if (!newest) return undefined;
  try {
    return await fs.readFile(snapPath(dir, newest.ts), 'utf-8');
  } catch {
    return undefined; // snapshot file vanished — treat as changed, re-capture
  }
}

/**
 * Record `content` as a new revision of `relPath`, unless it's byte-identical to
 * the latest one. `source` says how the write came about (origin + the
 * user-facing cause shown in the timeline). Then prune the note's history to the retention window. `now`
 * is injectable for tests. No-op (returns null) when nothing was captured;
 * otherwise returns the new revision's metadata.
 */
export async function captureSnapshot(
  rootPath: string,
  relPath: string,
  content: string,
  source: RevisionSource,
  now: number = Date.now(),
): Promise<RevisionMeta | null> {
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
  };
  await fs.writeFile(snapPath(dir, ts), content, 'utf-8');
  entries.push(meta);

  const { kept, removed } = selectForRetention(entries, now);
  await Promise.all(
    removed.map((r) => fs.rm(snapPath(dir, r.ts), { force: true })),
  );
  await writeIndex(dir, kept);
  return meta;
}

/** A note's revisions, newest first (metadata only — no content). */
export async function listRevisions(rootPath: string, relPath: string): Promise<RevisionMeta[]> {
  const entries = await readIndex(noteDir(rootPath, relPath));
  return entries.sort((a, b) => b.ts - a.ts);
}

/** The content of one revision, or null if it's gone. */
export async function getRevisionContent(rootPath: string, relPath: string, ts: number): Promise<string | null> {
  try {
    return await fs.readFile(snapPath(noteDir(rootPath, relPath), ts), 'utf-8');
  } catch {
    return null;
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

/** Set (or clear, with undefined) a revision's label — version tagging. Stored
 *  now; no UI yet (#1158 keeps tagging non-foreclosed). Labeled revisions are
 *  exempt from pruning. */
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
}
