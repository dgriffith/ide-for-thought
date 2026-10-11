/**
 * Coalesce graph-changed signals into renderer broadcasts (#2742).
 *
 * `emitGraphChanged` fires once per note indexed or removed — so once per note
 * across a project-open rebuild, and several times for one approved proposal
 * bundle. Each broadcast makes every open view re-run its projection, so a
 * burst becomes ONE broadcast per project, sent once the burst has been quiet
 * for `GRAPH_CHANGED_COALESCE_MS`. Short enough to read as immediate after a
 * save; long enough to swallow a bulk write.
 *
 * The owed broadcast is per-project state, so it lives in a project-store slot
 * (#2240): closing a thoughtbase disposes the slot and cancels the timer
 * instead of broadcasting to a project nothing has open. The slot exists only
 * while a broadcast is owed.
 */
import { onGraphChanged } from '../graph/graph-events';
import { createProjectStore } from '../project-store';
import { projectContext } from '../project-context-types';

export const GRAPH_CHANGED_COALESCE_MS = 150;

const owed = createProjectStore<{ timer: ReturnType<typeof setTimeout> }>({
  dispose: (slot) => { clearTimeout(slot.timer); },
});

/**
 * Subscribe `send` to coalesced graph changes. Returns the unsubscribe fn.
 * `send` gets each project that changed, once per burst.
 */
export function coalesceGraphChanged(
  send: (rootPath: string) => void,
  delayMs: number = GRAPH_CHANGED_COALESCE_MS,
): () => void {
  const off = onGraphChanged((rootPath) => {
    const ctx = projectContext(rootPath);
    const slot = owed.get(ctx);
    if (slot) clearTimeout(slot.timer);
    const timer = setTimeout(() => {
      void owed.dispose(ctx);
      send(rootPath);
    }, delayMs);
    timer.unref?.();
    owed.set(ctx, { timer });
  });
  return () => {
    off();
    for (const rootPath of owed.keys()) void owed.dispose(projectContext(rootPath));
  };
}
