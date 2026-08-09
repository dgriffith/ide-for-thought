/**
 * "The graph changed" pub/sub (#1795) — Electron-free, no imports.
 *
 * `indexers.ts` is the one place every write to the graph passes through: the
 * IPC write path, the file watcher, conversation drafts, source ingest. Rather
 * than remembering to poke the health checks from each of those (the shape of
 * bug #1794 — three callers, one of them wired), they all emit here and
 * whatever cares subscribes.
 *
 * Same pattern as `llm/proposal-events.ts`, and for the same reason: the emit
 * has to work in the CLI/MCP process where no Electron window exists. Nobody
 * subscribes there, so it costs nothing.
 *
 * Deliberately a *signal*, not a payload: subscribers re-derive whatever they
 * need. Which note changed is irrelevant to a check that reads the whole graph.
 */

type GraphChangedListener = (rootPath: string) => void;

const listeners = new Set<GraphChangedListener>();

/** Subscribe to graph writes. Returns an unsubscribe fn. */
export function onGraphChanged(fn: GraphChangedListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/**
 * Notify subscribers that `rootPath`'s graph changed. Called on every note
 * index / removal, so it fires in bursts — a bulk index at project open emits
 * once per note. Subscribers are expected to debounce; this stays dumb.
 */
export function emitGraphChanged(rootPath: string): void {
  for (const fn of listeners) {
    try {
      fn(rootPath);
    } catch (err) {
      console.warn('[graph-events] listener threw:', err instanceof Error ? err.message : err);
    }
  }
}
