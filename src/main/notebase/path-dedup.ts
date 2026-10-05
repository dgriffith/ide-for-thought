/**
 * Path-level dedup window between IPC writes and watcher events.
 *
 * The watcher and the IPC handlers can both react to the same write —
 * IPC because it just performed the write, watcher because chokidar
 * picked up the resulting fs event. Without dedup, the file is indexed
 * twice (and broadcast twice). The IPC path marks each path it just
 * touched; the watcher consults the mark before re-running the same
 * pipeline.
 *
 * The window is short-lived so a real subsequent edit (the user typing
 * after a save lands) still triggers the watcher pipeline normally.
 */

const DEDUP_WINDOW_MS = 2000;

const recentlyHandledPaths = new Map<string, number>();

/** Stamp `relativePath` as just-written-by-IPC. */
export function markPathHandled(relativePath: string): void {
  recentlyHandledPaths.set(relativePath, Date.now());
}

/**
 * True when a write to `relativePath` was marked within the dedup window.
 * Lazily evicts expired entries so the map can't grow unbounded under a
 * write-heavy workload.
 */
export function wasHandled(relativePath: string): boolean {
  const ts = recentlyHandledPaths.get(relativePath);
  if (!ts) return false;
  if (Date.now() - ts > DEDUP_WINDOW_MS) {
    recentlyHandledPaths.delete(relativePath);
    return false;
  }
  return true;
}

/**
 * Paths an in-app rename or move just took a note (or folder) AWAY from
 * (#2594). The watcher's `unlink` for such a path is not a deletion: the
 * renamer broadcasts NOTEBASE_RENAMED itself, and the tab follows that. An
 * in-app unlink used to be surfaced as FILE_DELETED at once, on the
 * assumption that RENAMED had already landed. An approved AI move broadcasts
 * RENAMED only after its whole bundle has applied, so on a loaded machine
 * FILE_DELETED won the race and closed the tab the move should have
 * retargeted.
 *
 * The window is longer than the dedup one because what it guards against is
 * a slow broadcast, not a duplicate event. A folder mark covers every path
 * under it, since a folder move unlinks each file it held.
 */
const MOVED_AWAY_WINDOW_MS = 10_000;
const movedAwayPaths = new Map<string, number>();

export function markPathMovedAway(relativePath: string): void {
  movedAwayPaths.set(relativePath, Date.now());
}

/** True when `relativePath`, or a folder containing it, was moved away within the window. */
export function wasMovedAway(relativePath: string): boolean {
  const now = Date.now();
  for (const [p, ts] of movedAwayPaths) {
    if (now - ts > MOVED_AWAY_WINDOW_MS) { movedAwayPaths.delete(p); continue; }
    if (relativePath === p || relativePath.startsWith(`${p}/`)) return true;
  }
  return false;
}

/** The path exists again (a rollback, or a new note at the old name): a later unlink of it is a real deletion. */
export function forgetMovedAway(relativePath: string): void {
  movedAwayPaths.delete(relativePath);
}

/** Test-only reset. */
export function _resetForTests(): void {
  recentlyHandledPaths.clear();
  movedAwayPaths.clear();
}
