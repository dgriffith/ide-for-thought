/**
 * IPC for local per-note history (#1158): list a note's revisions, read one
 * revision's content, restore a revision, and name versions. Capture is
 * automatic (hooked in `notebase/fs.ts:writeFile`), so there's no "save a
 * revision" channel — labeling names a version that already exists. The
 * per-machine limits (retention, per-note cap, size cutoff) live here too.
 */
import { Channels } from '../../shared/channels';
import { handle } from './typed-ipc';
import { withRootPath, rootPathFromEvent, hooks } from './helpers';
import { writeAndReindex } from '../notebase/write-pipeline';
import { formatDateTime } from '../../shared/format-datetime';
import type { HistorySettings, LabelNotesResult } from '../../shared/history';
import * as history from '../history';

export function registerHistory(): void {
  handle(Channels.HISTORY_LIST, withRootPath((rootPath, relativePath: string) =>
    history.listRevisions(rootPath, relativePath)));

  handle(Channels.HISTORY_GET_REVISION, withRootPath((rootPath, relativePath: string, ts: number) =>
    history.getRevisionContent(rootPath, relativePath, ts)));

  handle(Channels.HISTORY_RESTORE, withRootPath(async (rootPath, relativePath: string, ts: number) => {
    const content = await history.getRevisionContent(rootPath, relativePath, ts);
    if (content === null) {
      throw new Error(`history: revision ${ts} of "${relativePath}" not found`);
    }
    // Restore = write the old content back as a NEW save (non-destructive; the
    // restore itself becomes a fresh `restore`-tagged revision). Not
    // broadcast-suppressed, so the open editor reloads via NOTEBASE_REWRITTEN.
    // The cause names WHICH version came back, so a timeline with several
    // restores in it stays readable.
    await history.runWithHistorySource(
      { origin: 'restore', cause: `Restored from ${formatDateTime(ts)}` },
      () => writeAndReindex(rootPath, relativePath, content, hooks),
    );
  }));

  // Name one revision (or clear its name with null) — a labeled version is
  // exempt from pruning, so it survives as a restore point past the window.
  handle(Channels.HISTORY_SET_LABEL, withRootPath((rootPath, relativePath: string, ts: number, label: string | null) =>
    history.setRevisionLabel(rootPath, relativePath, ts, label ?? undefined)));

  // Label the CURRENT version of several notes at once — one named restore
  // point across a set of notes. A note that can't be labeled (deleted under
  // us, unreadable) is reported per-item rather than aborting the batch: the
  // user asked for a restore point across N notes, and getting N-1 of them
  // plus a list of what failed beats getting none.
  handle(Channels.HISTORY_LABEL_NOTES, withRootPath(async (rootPath, relativePaths: string[], label: string): Promise<LabelNotesResult> => {
    const labeled: string[] = [];
    const errors: LabelNotesResult['errors'] = [];
    for (const relativePath of relativePaths) {
      try {
        await history.labelCurrentVersion(rootPath, relativePath, label);
        labeled.push(relativePath);
      } catch (err) {
        errors.push({ path: relativePath, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return { label, labeled, errors };
  }));

  // The limits are per-machine, so reading them doesn't need a project — the
  // Settings dialog can be open with no thoughtbase.
  handle(Channels.HISTORY_GET_SETTINGS, () => history.getHistorySettings());

  handle(Channels.HISTORY_SET_SETTINGS, async (e, settings: HistorySettings) => {
    const saved = await history.setHistorySettings(settings);
    // Re-prune the open thoughtbase right away: lowering a limit should free
    // disk now, not note-by-note as each one next happens to be edited. Only
    // the open project is reachable from here — the rest catch up on their own
    // next capture. Best-effort; a prune failure must not fail the save.
    const rootPath = rootPathFromEvent(e);
    if (rootPath) {
      try {
        const { notes, removed } = await history.pruneAllHistory(rootPath, Date.now(), saved);
        if (removed > 0) console.log(`[history] pruned ${removed} revision(s) across ${notes} note(s)`);
      } catch (err) {
        console.warn('[history] prune after settings change failed:', err);
      }
    }
    return saved;
  });
}
