/**
 * Local per-note history — public facade (#1158). Wires the capture hook to the
 * note-write path and re-exports the store's reads for the IPC layer.
 *
 * Capture is hooked in `notebase/fs.ts:writeFile`, so every persisted note
 * change is recorded from a single point — editor saves, a restored revision,
 * and applied AI proposals all flow through it. History is BEST-EFFORT: a
 * capture failure is logged and swallowed so it can never break a save.
 *
 * Import boundary (no cycle): `notebase/fs` → this → `store` → `policy`. Restore
 * ORCHESTRATION (write-back + reindex + editor reload) lives in the IPC layer,
 * which composes this facade with `notebase`'s `writeAndReindex` — never the
 * reverse.
 */
import { captureSnapshot, ensureInitialRevision } from './store';
import type { RevisionSource } from './policy';

export {
  listRevisions,
  getRevisionContent,
  moveHistory,
  setRevisionLabel,
} from './store';
export type { RevisionMeta, RevisionOrigin, RevisionSource } from './policy';

// Ambient source for the next capture. Note writes are serialized per note, so
// a simple module var is sufficient to tag a restore / AI-applied write without
// threading it through the whole write pipeline. Defaults to a manual edit.
const MANUAL_EDIT: RevisionSource = { origin: 'edit' };
let ambientSource: RevisionSource = MANUAL_EDIT;

/**
 * Run `fn` (a note write) recording any revisions it produces as `source` —
 * e.g. `runWithHistorySource({ origin: 'restore', cause: 'Restored from …' },
 * () => writeAndReindex(...))`. The `cause` is what the History panel shows in
 * its "what did this?" column, so name the user's action ("Auto-tag",
 * "Antithesize"), not the module doing the write. Restores the previous source
 * afterward even if `fn` throws.
 */
export async function runWithHistorySource<T>(source: RevisionSource, fn: () => Promise<T>): Promise<T> {
  const prev = ambientSource;
  ambientSource = source;
  try {
    return await fn();
  } finally {
    ambientSource = prev;
  }
}

/** v1 captures markdown notes only; other writes (assets, `.minerva` internals,
 *  ttl/csv/py) are out of scope for note time-travel. */
function isCapturable(relPath: string): boolean {
  return relPath.endsWith('.md') && !relPath.startsWith('.minerva/') && !relPath.startsWith('.minerva\\');
}

/**
 * Pre-write hook, called from `notebase/fs.ts:writeFile` BEFORE the file is
 * overwritten. Gives a note that has no history yet a baseline revision from
 * its current on-disk content, so the state before the user's first edit stays
 * recoverable. No-op once a note has any history. Best-effort, like capture.
 */
export async function onNoteWriting(rootPath: string, relPath: string): Promise<void> {
  if (!isCapturable(relPath)) return;
  try {
    await ensureInitialRevision(rootPath, relPath);
  } catch (err) {
    console.error(`[history] initial-revision capture failed for "${relPath}":`, err);
  }
}

/**
 * Capture hook, called from `notebase/fs.ts:writeFile` after a successful write.
 * Awaited by the writer (captures are tiny + this serializes per-note index
 * updates), but never throws — a history failure must not fail the user's save.
 */
export async function onNoteWritten(rootPath: string, relPath: string, content: string): Promise<void> {
  if (!isCapturable(relPath)) return;
  try {
    await captureSnapshot(rootPath, relPath, content, ambientSource);
  } catch (err) {
    console.error(`[history] capture failed for "${relPath}":`, err);
  }
}
