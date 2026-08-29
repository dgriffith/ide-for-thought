/**
 * A tiny, Electron-free pub/sub for "the proposal set changed" (#1524).
 *
 * `approval.ts` is shared verbatim by the CLI/MCP (which is Electron-free — see
 * epic #1145), so it cannot `webContents.send` directly. Instead the approval
 * lifecycle (propose / approve / reject / expire) calls `emitProposalsChanged`,
 * and the *app* process subscribes once at startup to turn that into a
 * `PROPOSALS_CHANGED` broadcast to the windows holding that project.
 *
 * In a CLI/MCP process nobody subscribes, so the emit is a harmless no-op — the
 * same core code path serves both, with the Electron dependency living only in
 * the app's subscriber.
 */

import { logger } from '../../shared/logger';

type ProposalsChangedListener = (rootPath: string) => void;

const listeners = new Set<ProposalsChangedListener>();

/** Subscribe to proposal-set changes. Returns an unsubscribe fn. */
export function onProposalsChanged(fn: ProposalsChangedListener): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}

/** Notify subscribers that `rootPath`'s pending-proposal set may have changed. */
export function emitProposalsChanged(rootPath: string): void {
  for (const fn of listeners) {
    try {
      fn(rootPath);
    } catch (err) {
      logger('proposal').warn('listener threw:', err instanceof Error ? err.message : err);
    }
  }
}
