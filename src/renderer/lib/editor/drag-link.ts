/**
 * Drag-to-add-link (#1129): dragging a note or source from a list panel into an
 * editor inserts a resolving wiki-link at the drop point.
 *
 * Two transports share this one link-format helper:
 *  - HTML5 drop, for surfaces that already own an HTML5 drag gesture (the file
 *    tree's move-to-folder, the bookmarks reorder). They stamp these MIME types
 *    onto the existing drag so the editor can accept the drop without regressing
 *    their own gesture.
 *  - Pointer-event drag (the polished path with a live insertion caret), for
 *    the panels that weren't draggable before — Related, Backlinks, Sources.
 *
 * The link strings match exactly what the wiki-link autocomplete inserts: a note
 * is its full extensionless stem (`notes/topic/raft`), a source is `cite::<id>`.
 */

import type { EditorView } from '@codemirror/view';

/** Custom dataTransfer MIME types for HTML5 drags that carry an internal item. */
export const DRAG_MIME_NOTE = 'application/x-minerva-note';
export const DRAG_MIME_SOURCE = 'application/x-minerva-source';

export type DraggedItem =
  | { kind: 'note'; path: string; label: string }
  | { kind: 'source'; sourceId: string; label: string };

/** The wiki-link text to insert for a dragged item — same format the
 *  autocomplete produces (`[[<stem>]]` for notes, `[[cite::<id>]]` for sources). */
export function wikiLinkForItem(item: DraggedItem): string {
  return item.kind === 'note'
    ? `[[${item.path.replace(/\.md$/i, '')}]]`
    : `[[cite::${item.sourceId}]]`;
}

/** Read an internal dragged item off an HTML5 dataTransfer, or null if it
 *  carries none (e.g. an OS file drop or a plain-text drag). */
export function draggedItemFromDataTransfer(dt: DataTransfer): DraggedItem | null {
  const notePath = dt.getData(DRAG_MIME_NOTE);
  if (notePath) return { kind: 'note', path: notePath, label: notePath };
  const sourceId = dt.getData(DRAG_MIME_SOURCE);
  if (sourceId) return { kind: 'source', sourceId, label: sourceId };
  return null;
}

/** True when a dragover's dataTransfer advertises an internal item — checked in
 *  `dragover`, where the payload can't be read yet but the type list can. */
export function dataTransferHasItem(dt: DataTransfer): boolean {
  return dt.types.includes(DRAG_MIME_NOTE) || dt.types.includes(DRAG_MIME_SOURCE);
}

/** Insert wiki-link `text` at `pos`, place the cursor after it, and focus.
 *  Adds a leading space when dropping mid-word so the link doesn't fuse onto the
 *  preceding character. Shared by the HTML5 drop handler and the pointer drag. */
export function insertWikiLinkAtPos(view: EditorView, pos: number, text: string): void {
  const before = view.state.sliceDoc(Math.max(0, pos - 1), pos);
  const needsSpace = before !== '' && before !== ' ' && before !== '\n' && before !== '\t';
  const insert = needsSpace ? ` ${text}` : text;
  view.dispatch({ changes: { from: pos, insert }, selection: { anchor: pos + insert.length } });
  view.focus();
}
