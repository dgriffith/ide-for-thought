/**
 * Multi-file/directory local history store (#2092) — the renderer half of the
 * #2088 epic's unified timeline + batch revert backend (#2090, #2091).
 *
 * Owns the "View Local History…" dialog's open/closed state and its merged
 * timeline across a selection of live paths (plus any orphaned/deleted note
 * histories found under the raw selection roots) — the same store-ownership
 * split as `stores/history.svelte.ts` for the single-note panel: the dialog
 * itself is a thin reader, this store owns the `HISTORY_CHANGED` subscription
 * and the two IPC calls (`listUnified`, `batchRevert`).
 */
import { api } from '../ipc/client';
import { getDialogStore } from './dialogs.svelte';
import { CONFIRM_KEYS } from '../confirm-keys';
import { logger } from '../../../shared/logger';
import type { BatchRevertResult, SelectionRoot, UnifiedTimelineEntry } from '../../../shared/history';

let open = $state(false);
let paths = $state<string[]>([]);
let selectionRoots = $state<SelectionRoot[]>([]);
let timeline = $state<UnifiedTimelineEntry[]>([]);
let loading = $state(false);
let error = $state<string | null>(null);
let subscribed = false;

async function load(): Promise<void> {
  loading = true;
  try {
    // Electron's structured-clone rejects a Svelte 5 $state Proxy crossing
    // the IPC boundary — snapshot to plain arrays first.
    const list = await api.history.listUnified($state.snapshot(paths), $state.snapshot(selectionRoots));
    // The dialog may have been closed (or reopened for a different selection)
    // while this was in flight; a late response must not repopulate a closed
    // dialog or clobber a newer selection's timeline.
    if (!open) return;
    timeline = list;
    error = null;
  } catch (err) {
    if (!open) return;
    logger('history').error('failed to list unified timeline:', err);
    timeline = [];
    error = err instanceof Error ? err.message : String(err);
  } finally {
    loading = false;
  }
}

function start(): void {
  if (subscribed) return;
  subscribed = true;
  // Session-lived, like the single-note history store. `relPath` is null when
  // a prune sweep touched many notes — refresh regardless in that case.
  api.history.onChanged((relPath) => {
    if (!open) return;
    if (relPath === null || paths.includes(relPath)) void load();
  });
}

export function getMultiFileHistoryStore() {
  start();
  return {
    get open(): boolean { return open; },
    get paths(): string[] { return paths; },
    get timeline(): UnifiedTimelineEntry[] { return timeline; },
    get loading(): boolean { return loading; },
    get error(): string | null { return error; },

    /** Open the dialog for a selection: `livePaths` is the renderer's already-
     *  expanded flat list of live note files, `roots` the raw (un-expanded)
     *  selection the backend additionally searches for orphaned histories. */
    openFor(livePaths: string[], roots: SelectionRoot[]): Promise<void> {
      open = true;
      paths = livePaths;
      selectionRoots = roots;
      return load();
    },

    close(): void {
      open = false;
      timeline = [];
      error = null;
    },

    /** Re-read the current selection's merged timeline. */
    refresh(): Promise<void> {
      return load();
    },

    /**
     * Revert the whole selection to a point in time. A real data-loss risk —
     * unlike a single-note restore, a file with no recorded history at `ts`
     * is deleted outright (documented gap, #2091) — so this confirms first,
     * dismissable like every other confirm in this codebase. Returns null if
     * the user declined.
     */
    async revert(ts: number): Promise<BatchRevertResult | null> {
      const ok = await getDialogStore().showConfirm(
        'Revert the selection to this point in time? Notes will be edited, undeleted, or removed to match — this cannot be undone from here.',
        CONFIRM_KEYS.multiFileHistoryRevert,
        'Revert',
      );
      if (!ok) return null;
      const result = await api.history.batchRevert($state.snapshot(paths), $state.snapshot(selectionRoots), ts);
      await load();
      return result;
    },
  };
}
