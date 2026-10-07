/**
 * Bring open note tabs up to date after the renderer itself rewrote their
 * files on disk — a bulk tag or property edit, a Kanban card move (#2603).
 *
 * `api.notebase.writeFile` suppresses the `rewritten` broadcast that normally
 * drives this (it assumes the writer is the editor saving its own buffer), so
 * the writer refreshes the views itself, the same way App's `onRewritten`
 * listener does for a link rewrite: a clean tab reloads, and a tab with
 * unsaved edits gets the external-change conflict prompt (dismissable, under
 * the shared `rewriteConflict` key). A tab whose user keeps their edits is
 * left alone.
 */
import { getEditorStore } from './editor.svelte';
import { getDialogStore } from './dialogs.svelte';
import { CONFIRM_KEYS } from '../confirm-keys';

export async function syncOpenTabsToDisk(paths: readonly string[]): Promise<void> {
  const editor = getEditorStore();
  for (const path of paths) {
    if (editor.isPathDirty(path)) {
      const keepDisk = await getDialogStore().showConfirm(
        `"${path}" is open with unsaved edits. Discard them and load the updated version?`,
        CONFIRM_KEYS.rewriteConflict,
        'Load disk',
      );
      if (!keepDisk) continue;
    }
    await editor.reloadTabFromDisk(path);
  }
}
