/**
 * A tiny, Electron-free pub/sub for "a note's history changed" (#1834).
 *
 * Same shape and same reason as `llm/proposal-events.ts`: `history/` sits below
 * the IPC layer and is on the CLI's import graph (`cli/engine.ts` → `notebase/fs`
 * → here), so it cannot `webContents.send` directly. The store emits; the *app*
 * process subscribes once at startup (`ipc.ts`) and turns that into a
 * `HISTORY_CHANGED` broadcast to the windows holding that project. In a CLI
 * process nobody subscribes and the emit is a harmless no-op.
 *
 * This is the seam the History panel was missing: with no event, it had to poll
 * on a timer to notice a revision it didn't cause.
 */

/** `relPath` is the note whose history changed, or null when many did (a prune
 *  sweep) — a listener that can't tell which should just refresh what it shows. */
type HistoryChangedListener = (rootPath: string, relPath: string | null) => void;

const listeners = new Set<HistoryChangedListener>();

/** Subscribe to history changes. Returns an unsubscribe fn. */
export function onHistoryChanged(fn: HistoryChangedListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Notify subscribers that `relPath`'s revisions changed (captured, labeled, or
 *  pruned). Never throws: a listener's failure must not break a save. */
export function emitHistoryChanged(rootPath: string, relPath: string | null): void {
  for (const fn of listeners) {
    try {
      fn(rootPath, relPath);
    } catch (err) {
      console.warn('[history-events] listener threw:', err instanceof Error ? err.message : err);
    }
  }
}
