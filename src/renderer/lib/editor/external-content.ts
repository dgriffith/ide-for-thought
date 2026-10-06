/**
 * Apply a content change that arrived from outside the editor — a preview
 * resize handle (#2666), a task-checkbox toggle, a cell output, a reload — as
 * the smallest edit that produces it, rather than replacing the whole doc.
 *
 * Both are undoable, but a whole-doc replacement makes ⌘Z restore the entire
 * document and throws the cursor and selection to the end; the minimal change
 * undoes exactly the edit, like typing would, and leaves the cursor where it
 * was when the edit was elsewhere.
 */
import type { EditorView } from '@codemirror/view';

export interface MinimalChange { from: number; to: number; insert: string }

/** The single replacement turning `oldDoc` into `newDoc`; null when equal. */
export function minimalChange(oldDoc: string, newDoc: string): MinimalChange | null {
  if (oldDoc === newDoc) return null;
  const max = Math.min(oldDoc.length, newDoc.length);
  let start = 0;
  while (start < max && oldDoc.charCodeAt(start) === newDoc.charCodeAt(start)) start++;
  let endOld = oldDoc.length;
  let endNew = newDoc.length;
  while (endOld > start && endNew > start && oldDoc.charCodeAt(endOld - 1) === newDoc.charCodeAt(endNew - 1)) {
    endOld--;
    endNew--;
  }
  return { from: start, to: endOld, insert: newDoc.slice(start, endNew) };
}

/** Dispatch `content` into `view` as one minimal, undoable change. */
export function applyExternalContent(view: EditorView, content: string): boolean {
  const change = minimalChange(view.state.doc.toString(), content);
  if (!change) return false;
  view.dispatch({ changes: change });
  return true;
}
