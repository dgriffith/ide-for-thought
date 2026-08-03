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
import { captureSnapshot } from './store';
import type { RevisionOrigin } from './policy';

export {
  listRevisions,
  getRevisionContent,
  moveHistory,
  setRevisionLabel,
} from './store';
export type { RevisionMeta, RevisionOrigin } from './policy';

// Ambient origin for the next capture. Note writes are serialized per note, so a
// simple module var is sufficient to tag a restore / AI-applied write without
// threading `origin` through the whole write pipeline. Defaults to a manual edit.
let ambientOrigin: RevisionOrigin = 'edit';

/** Run `fn` (a note write) tagging any revisions it produces with `origin` —
 *  e.g. `runWithHistoryOrigin('restore', () => writeAndReindex(...))`. Restores
 *  to the ambient default afterward even if `fn` throws. */
export async function runWithHistoryOrigin<T>(origin: RevisionOrigin, fn: () => Promise<T>): Promise<T> {
  const prev = ambientOrigin;
  ambientOrigin = origin;
  try {
    return await fn();
  } finally {
    ambientOrigin = prev;
  }
}

/** v1 captures markdown notes only; other writes (assets, `.minerva` internals,
 *  ttl/csv/py) are out of scope for note time-travel. */
function isCapturable(relPath: string): boolean {
  return relPath.endsWith('.md') && !relPath.startsWith('.minerva/') && !relPath.startsWith('.minerva\\');
}

/**
 * Capture hook, called from `notebase/fs.ts:writeFile` after a successful write.
 * Awaited by the writer (captures are tiny + this serializes per-note index
 * updates), but never throws — a history failure must not fail the user's save.
 */
export async function onNoteWritten(rootPath: string, relPath: string, content: string): Promise<void> {
  if (!isCapturable(relPath)) return;
  try {
    await captureSnapshot(rootPath, relPath, content, ambientOrigin);
  } catch (err) {
    console.error(`[history] capture failed for "${relPath}":`, err);
  }
}
