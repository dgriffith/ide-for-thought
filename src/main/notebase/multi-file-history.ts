/**
 * Multi-file/directory local history read path AND batch point-in-time
 * revert (#2090/#2091, epic #2088). Peer to `write-pipeline.ts` — lives
 * outside `main/history/` because it needs both `history.*` reads and
 * `notebase/fs.ts`'s write/delete + orphan search, and `main/history` must
 * not depend on `notebase/fs` (capture is hooked FROM `notebase/fs`, so the
 * reverse import would cycle).
 *
 * Design note: the renderer already has the live file tree loaded and
 * already knows how to expand a directory selection into a flat list of live
 * note paths (`expandSelectionToNotes` in `sidebar-tree-utils.ts` — the same
 * helper `refactor-ops.svelte.ts`'s `bulkTagTargets()` uses for the analogous
 * label-version flow). Re-implementing that walk here would just be a second,
 * driftable copy of the same tree logic. The backend only does the one thing
 * the renderer can't: find ORPHANED (deleted) note histories under the
 * selected directories — a live tree has nothing to show for a note that no
 * longer exists. Callers hand over both the already-expanded live paths and
 * the raw selection roots so this module knows which directories to search.
 */
import * as notebaseFs from './fs';
import * as search from '../search/index';
import { removeAllFor } from './index-fanout';
import { writeAndReindex, type WritePipelineHooks } from './write-pipeline';
import { projectContext } from '../project-context-types';
import { formatDateTime } from '../../shared/format-datetime';
import * as history from '../history';
import { resolveAsOf, type BatchRevertResult, type SelectionRoot, type UnifiedTimelineEntry } from '../../shared/history';

/**
 * Every orphaned (deleted) note-history path under the selection's directory
 * roots. A file root never needs an orphan search — the sidebar tree only
 * ever lists LIVE files, so a file selection is by definition already in the
 * caller's expanded live-paths list.
 */
export async function resolveOrphanedTargets(rootPath: string, selectionRoots: SelectionRoot[]): Promise<string[]> {
  const orphaned = new Set<string>();
  for (const root of selectionRoots) {
    if (!root.isDirectory) continue;
    const found = await history.listOrphanedNoteHistoriesUnder(rootPath, root.relativePath);
    for (const relPath of found) orphaned.add(relPath);
  }
  return [...orphaned];
}

/**
 * The unified timeline for a selection: the renderer's live note paths, plus
 * whatever orphaned histories this module finds under the selected
 * directories, merged into one sorted (newest-first) view.
 */
export async function listNoteHistoryTimeline(
  rootPath: string,
  livePaths: string[],
  selectionRoots: SelectionRoot[],
): Promise<UnifiedTimelineEntry[]> {
  const orphaned = await resolveOrphanedTargets(rootPath, selectionRoots);
  const allPaths = [...new Set([...livePaths, ...orphaned])];
  return history.listUnifiedTimeline(rootPath, allPaths);
}

/**
 * Revert an entire selection to how it looked at a single moment (#2091):
 * every target resolves independently via `resolveAsOf`, so a file untouched
 * at that moment is left alone, a file deleted after that moment is
 * recreated (undelete), and — the symmetric completion, since "point-in-time,
 * whole-set" only means something if both directions hold — a file that
 * didn't exist yet at that moment but exists now is deleted to match.
 *
 * A note with NO recorded history at all (never captured — e.g. created by
 * an external tool before local history existed, or before this feature
 * shipped) resolves to `absent` for every `ts`, since nothing establishes
 * when it actually started existing. Reverting a selection containing one to
 * any moment in the past therefore deletes it (bucket `removed`) — the
 * honestly-available answer given no other signal exists (matches the
 * epic's own no-backfill stance for delete markers), not a bug to route
 * around. The bucket it lands in makes this visible to whatever
 * confirmation UI #2092 builds on top, rather than silently reinterpreting
 * a documented gap as something friendlier.
 *
 * Per-target `runWithHistorySource`, never once around the whole loop —
 * mirrors `HISTORY_RESTORE`'s own single-target shape, applied per item, so
 * concurrent unrelated writes elsewhere can't borrow this batch's cause via
 * the shared `AsyncLocalStorage` context (#1833). Sequential, per-item
 * try/catch into `errors` — mirrors `HISTORY_LABEL_NOTES`'s existing
 * per-item-outcome-without-abort contract; one bad path doesn't abort the
 * rest of the selection.
 */
export async function batchRevertToPointInTime(
  rootPath: string,
  liveNotePaths: string[],
  selectionRoots: SelectionRoot[],
  ts: number,
  hooks: WritePipelineHooks,
): Promise<BatchRevertResult> {
  const livePathSet = new Set(liveNotePaths);
  const orphaned = await resolveOrphanedTargets(rootPath, selectionRoots);
  const allPaths = [...new Set([...liveNotePaths, ...orphaned])];

  const result: BatchRevertResult = {
    ts, reverted: [], recreated: [], removed: [], unchanged: [], skipped: [], errors: [],
  };
  const ctx = projectContext(rootPath);
  let deletedAny = false;

  for (const relPath of allPaths) {
    try {
      const existsNow = livePathSet.has(relPath);
      const entries = await history.listRevisions(rootPath, relPath);
      const state = resolveAsOf(entries, ts);

      if (state === 'absent' || state === 'deleted') {
        // The target state is "doesn't exist". Delete to match if it
        // currently does; otherwise it already matches.
        if (existsNow) {
          hooks.markPathHandled(relPath);
          await notebaseFs.deleteFile(rootPath, relPath);
          removeAllFor(ctx, relPath);
          deletedAny = true;
          result.removed.push(relPath);
        } else {
          result[state === 'absent' ? 'skipped' : 'unchanged'].push(relPath);
        }
        continue;
      }

      const targetContent = await history.getRevisionContent(rootPath, relPath, state.ts);
      if (targetContent === null) {
        throw new Error(`revision ${state.ts} of "${relPath}" not found`);
      }
      const currentContent = existsNow ? await notebaseFs.readFile(rootPath, relPath) : null;
      if (currentContent === targetContent) {
        result.unchanged.push(relPath);
        continue;
      }

      await history.runWithHistorySource(
        { origin: 'restore', cause: `Reverted to ${formatDateTime(ts)} (batch)` },
        () => writeAndReindex(rootPath, relPath, targetContent, hooks),
      );
      result[existsNow ? 'reverted' : 'recreated'].push(relPath);
    } catch (err) {
      result.errors.push({ path: relPath, error: err instanceof Error ? err.message : String(err) });
    }
  }

  // One persist for the whole batch's deletes, not per-item — writeAndReindex
  // already schedules its own debounced persist per write-back, so this only
  // covers the delete-to-match side, which bypasses that pipeline entirely.
  if (deletedAny) await search.persist(ctx);

  return result;
}
