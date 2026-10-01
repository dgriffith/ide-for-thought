/**
 * Wrap an async "recompute and publish" so overlapping requests can't publish
 * out of order.
 *
 * The bug this exists for (the dock badge): each proposals-changed event
 * started its own `count pending → setBadgeCount`, unordered. Approving a
 * conversation draft files a proposal and approves it at once — two events
 * back to back — and when the first count (taken while the proposal was still
 * pending) finished LAST, it overwrote the right number and the badge stayed
 * one too high.
 *
 * Here at most one run is in flight. A request that arrives during a run marks
 * it dirty, and the run goes round again once it finishes, so the last publish
 * always comes from a run that STARTED after the last request. A burst of N
 * requests costs at most two runs. The returned promise resolves once a run
 * that started after the call has finished.
 */
export function coalescedRun(fn: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | null = null;
  let dirty = false;
  return () => {
    dirty = true;
    if (!running) {
      running = (async () => {
        try {
          while (dirty) {
            dirty = false;
            await fn();
          }
        } finally {
          running = null;
        }
      })();
    }
    return running;
  };
}
