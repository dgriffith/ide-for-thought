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

/** Test-only reset. */
export function _resetForTests(): void {
  recentlyHandledPaths.clear();
}
