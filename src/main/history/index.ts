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
import { AsyncLocalStorage } from 'node:async_hooks';
import { captureSnapshot, ensureInitialRevision } from './store';
import { isNotePath } from '../../shared/note-extensions';
import type { RevisionSource } from './policy';
import { logger } from '../../shared/logger';

export {
  listRevisions,
  getRevisionContent,
  moveHistory,
  setRevisionLabel,
  labelCurrentVersion,
  pruneAllHistory,
} from './store';
export { getHistorySettings, setHistorySettings } from './settings';
export { onHistoryChanged, emitHistoryChanged } from './history-events';
export type { RevisionMeta, RevisionOrigin, RevisionSource } from './policy';

// How a write in flight should be recorded, carried as ASYNC CONTEXT rather
// than as a module variable (#1833).
//
// This was a `let ambientSource` saved and restored around `await fn()`, which
// is only correct when scopes nest strictly. They don't: six call sites wrap
// await-heavy writes (`notebase/fs`, `llm/approval`'s whole `applyBundle`, four
// IPC handlers), nothing in main serializes them, and every window carries its
// own project — so two writes are genuinely concurrent. Interleave
// A(set X) → B(set Y, saving X) → A(restore its default) → B(restore X) and the
// module var is left at X with no scope active, after which ordinary editor
// saves are filed as someone else's AI proposal. That is silent corruption of
// the provenance the `origin`/`cause` fields exist to record.
//
// `AsyncLocalStorage` gives each async call tree its own value, so overlapping
// writes can't see each other's and nothing has to be restored.
const MANUAL_EDIT: RevisionSource = { origin: 'edit' };
const historySource = new AsyncLocalStorage<RevisionSource>();

/**
 * Run `fn` (a note write) recording any revisions it produces as `source` —
 * e.g. `runWithHistorySource({ origin: 'restore', cause: 'Restored from …' },
 * () => writeAndReindex(...))`. The `cause` is what the History panel shows in
 * its "what did this?" column, so name the user's action ("Auto-tag",
 * "Antithesize"), not the module doing the write.
 *
 * The source applies to everything `fn` awaits, and to nothing outside it —
 * including a concurrent write that started while `fn` was in flight.
 */
export function runWithHistorySource<T>(source: RevisionSource, fn: () => Promise<T>): Promise<T> {
  return historySource.run(source, fn);
}

/**
 * History covers every first-class note format (.md/.ttl/.csv/.py — see
 * `shared/note-extensions`), because they're all notes the user edits and
 * expects to be able to walk back. Assets and `.minerva` internals are out of
 * scope: the former aren't notes, the latter includes history's own storage
 * (capturing it would recurse).
 */
function isCapturable(relPath: string): boolean {
  return isNotePath(relPath) && !relPath.startsWith('.minerva/') && !relPath.startsWith('.minerva\\');
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
    logger('history').error(`initial-revision capture failed for "${relPath}":`, err);
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
    await captureSnapshot(rootPath, relPath, content, historySource.getStore() ?? MANUAL_EDIT);
  } catch (err) {
    logger('history').error(`capture failed for "${relPath}":`, err);
  }
}
