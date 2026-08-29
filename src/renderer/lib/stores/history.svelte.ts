/**
 * Note-history store (#1834).
 *
 * History was the only domain with no store: its mutations lived in
 * `App.svelte`, its list state lived in the panel, and — because main had no
 * "a revision was captured" event — the panel polled on a 700 ms timer to
 * notice saves it didn't cause. This owns the `history:changed` subscription
 * (main→renderer subscriptions belong in a store, per the renderer data-flow
 * rule), the revision list for the note being watched, and the three
 * mutations.
 *
 * The panel keeps what is genuinely view state: which revision is selected,
 * its content, the diff, and the context menu. Selection content is read
 * directly there — reads are allowed in components.
 *
 * The dialogs live here, not in the panel: restoring asks for confirmation and
 * naming asks for the name, and those belong with the mutation they gate. The
 * conversations store does the same.
 */
import { api } from '../ipc/client';
import { getDialogStore } from './dialogs.svelte';
import { CONFIRM_KEYS } from '../confirm-keys';
import { logger } from '../../../shared/logger';
import type { RevisionMeta } from '../../../shared/history';

let watched = $state<string | null>(null);
let revisions = $state<RevisionMeta[]>([]);
/**
 * Why the watched note's history couldn't be read, or null.
 *
 * Main now throws on a corrupt revision index instead of reporting it as "no
 * history yet" (#1835). That's only an improvement if the renderer says so —
 * swallowing the rejection here would put the panel right back to showing an
 * empty timeline for a note whose past is sitting damaged on disk.
 */
let error = $state<string | null>(null);
/** Bumped whenever `revisions` is replaced, so a panel can re-stamp "now" for
 *  its date formatting without diffing the list. */
let revision = $state(0);
let subscribed = false;

async function load(): Promise<void> {
  const path = watched;
  if (!path) {
    revisions = [];
    error = null;
    revision += 1;
    return;
  }
  try {
    const list = await api.history.list(path);
    // Another note may have been selected while this was in flight; a late
    // response must not overwrite the newer note's list.
    if (watched !== path) return;
    revisions = list;
    error = null;
    revision += 1;
  } catch (err) {
    if (watched !== path) return;
    logger('history').error('failed to list revisions:', err);
    revisions = [];
    error = err instanceof Error ? err.message : String(err);
    revision += 1;
  }
}

function start(): void {
  if (subscribed) return;
  subscribed = true;
  // Session-lived, like the other store subscriptions. `relPath` is null when a
  // prune sweep touched many notes — refresh regardless in that case.
  api.history.onChanged((relPath) => {
    if (relPath === null || relPath === watched) void load();
  });
}

export function getHistoryStore() {
  start();
  return {
    /** The watched note's revisions, newest first. */
    get revisions(): RevisionMeta[] { return revisions; },
    /** Bumped on every list replacement. */
    get revision(): number { return revision; },
    /** Why the watched note's history couldn't be read, or null. */
    get error(): string | null { return error; },

    /**
     * One revision's content, for the diff. Returns null when the revision is
     * gone; a real read failure surfaces through `error` rather than reading to
     * the user as an empty version.
     */
    async readRevision(relativePath: string, ts: number): Promise<string | null> {
      try {
        const content = await api.history.getRevision(relativePath, ts);
        error = null;
        return content;
      } catch (err) {
        logger('history').error('failed to read a revision:', err);
        error = err instanceof Error ? err.message : String(err);
        return null;
      }
    },

    /**
     * Point the store at a note (or `null` for "no note open"). Idempotent, so
     * a panel can call it from an effect on every render.
     */
    watch(relativePath: string | null): void {
      if (watched === relativePath) return;
      watched = relativePath;
      void load();
    },

    /** Re-read the watched note's revisions. */
    refresh(): Promise<void> {
      return load();
    },

    /**
     * Restore a note to an earlier version. Non-destructive — the current text
     * is captured as a revision of its own first — so the confirm is
     * dismissable. Returns false if the user declined.
     */
    async restore(relativePath: string, ts: number): Promise<boolean> {
      const ok = await getDialogStore().showConfirm(
        'Restore this note to the selected version? Your current text is kept in history.',
        CONFIRM_KEYS.historyRestore,
        'Restore',
      );
      if (!ok) return false;
      await api.history.restore(relativePath, ts);
      return true;
    },

    /**
     * Name a version, prompting seeded with its current name. A named version
     * is exempt from pruning, so this is how a restore point outlives the
     * retention window. Returns false if the user cancelled.
     */
    async label(relativePath: string, ts: number, existing: string | null): Promise<boolean> {
      const raw = await getDialogStore().showPrompt('Name this version:', existing ?? '');
      if (raw === null) return false;
      const label = raw.trim();
      // An emptied prompt reads as "drop the name" rather than storing ''.
      await api.history.setLabel(relativePath, ts, label || null);
      return true;
    },

    /** Drop a version's name. No confirm: the version itself is untouched, and
     *  re-labeling is one right-click away. */
    async removeLabel(relativePath: string, ts: number): Promise<void> {
      await api.history.setLabel(relativePath, ts, null);
    },
  };
}
