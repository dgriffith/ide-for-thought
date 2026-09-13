/**
 * Asset ops (#1799) — the "Delete image" quick-fix for the "Unreferenced
 * images" inspection. No confirm dialog: this is one explicit click on a
 * specific finding, the same as the panel's other deterministic fixes
 * (create-note, remove-anchor, ...), not a bulk or destructive-by-default
 * action.
 */
import { api } from '../ipc/client';

export async function deleteAsset(relativePath: string): Promise<void> {
  await api.notebase.deleteFile(relativePath);
}
