/**
 * "The inspection results changed" pub/sub (#1795) — Electron-free, no imports.
 *
 * Checks now re-run a couple of seconds after any graph write, so results
 * change without the user pressing anything. The panel has to hear about it or
 * it would sit on a stale list until the next manual Run — which is precisely
 * the confusion this whole change is fixing.
 *
 * Same shape as `graph-events.ts` / `llm/proposal-events.ts`: the app process
 * subscribes once and turns it into a window broadcast; the CLI/MCP process
 * doesn't subscribe and pays nothing.
 */

type InspectionsChangedListener = (rootPath: string) => void;

const listeners = new Set<InspectionsChangedListener>();

export function onInspectionsChanged(fn: InspectionsChangedListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

export function emitInspectionsChanged(rootPath: string): void {
  for (const fn of listeners) {
    try {
      fn(rootPath);
    } catch (err) {
      console.warn('[inspection-events] listener threw:', err instanceof Error ? err.message : err);
    }
  }
}
