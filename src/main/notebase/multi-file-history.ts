/**
 * Multi-file/directory local history read path (#2090, epic #2088). Peer to
 * `write-pipeline.ts` — lives outside `main/history/` because it needs both
 * `history.*` reads and `notebase/fs.ts`'s orphan search, and `main/history`
 * must not depend on `notebase/fs` (capture is hooked FROM `notebase/fs`, so
 * the reverse import would cycle).
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
import * as history from '../history';
import type { SelectionRoot, UnifiedTimelineEntry } from '../../shared/history';

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
