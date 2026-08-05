/**
 * Nav-history recording for programmatic note opens (#1446). The nav-view
 * handlers do a two-step record around every user navigation — capture where
 * you are, open, record the destination — so Back/Forward work. Openers in
 * other op clusters (note-ops create/merge/safe-delete, template-ops and
 * refactor-ops note creation) called `editor.openFile` directly and so left
 * Back dead. This shares the recording so every one of them participates.
 */
import { getEditorStore } from '../stores/editor.svelte';
import { getNavigationStore, type NavPosition } from '../stores/navigation.svelte';

/** The current editor location as a NavPosition — note (with caret offset),
 *  query, or source/pdf. `null` when there's nothing recordable. Mirrors
 *  nav-view's `recordCurrentPosition`, extended to source/pdf so Back returns
 *  to a source you created a note from. */
function currentPosition(getOffset: () => number | undefined): NavPosition | null {
  const editor = getEditorStore();
  const tab = editor.activeTab;
  if (!tab) return null;
  switch (tab.type) {
    case 'note':
      return editor.activeFilePath
        ? { type: 'note', relativePath: editor.activeFilePath, offset: getOffset() ?? 0 }
        : null;
    case 'query':
      return { type: 'query', tabId: tab.id };
    case 'source':
    case 'pdf':
      return { type: 'source', sourceId: tab.sourceId };
    default:
      return null;
  }
}

/**
 * Open `relativePath`, recording nav history so Back returns to the current
 * position. `getOffset` reads the active editor caret for a note from-position.
 * `excludeCurrent` skips recording the from-position when the caller is about
 * to delete that note (merge's source), so Back never targets a dead note.
 */
export async function openNoteRecordingHistory(
  relativePath: string,
  getOffset: () => number | undefined,
  opts?: { excludeCurrent?: string },
): Promise<void> {
  const editor = getEditorStore();
  const nav = getNavigationStore();
  const cur = currentPosition(getOffset);
  // Don't record a note from-position that's the destination itself or a note
  // being deleted; other kinds (query/source) always record.
  const skip = cur?.type === 'note'
    && (cur.relativePath === relativePath || cur.relativePath === opts?.excludeCurrent);
  if (cur && !skip) nav.record(cur);
  await editor.openFile(relativePath);
  nav.record({ type: 'note', relativePath, offset: 0 });
}
