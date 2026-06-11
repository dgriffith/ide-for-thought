/**
 * Image detection for the editor's drag/drop + paste upload path (#455,
 * extracted in #672 from Editor.svelte).
 *
 * These pure helpers inspect a DataTransfer / clipboard items without
 * consuming them, so the dragover gate can decide whether to intercept the
 * drop (image → editor upload) or let it fall through to CodeMirror's default
 * text-drop handling and App.svelte's project-import drop.
 */

/**
 * True iff the DataTransfer carries at least one image file. `items` is the
 * modern surface; `files` is the fallback — either lets us spot an image
 * without reading the payload.
 */
export function hasImageFiles(dt: DataTransfer): boolean {
  if (dt.items) {
    for (const item of dt.items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) return true;
    }
  }
  if (dt.files) {
    for (const f of dt.files) {
      if (f.type.startsWith('image/')) return true;
    }
  }
  return false;
}

/** The image Files in a drop's DataTransfer.files (the drop handler path). */
export function imageFilesFromTransfer(dt: DataTransfer): File[] {
  return Array.from(dt.files).filter((f) => f.type.startsWith('image/'));
}

/**
 * The image Files among clipboard items (the paste handler path). Skips
 * non-file items (text/html) and any item whose `getAsFile()` returns null.
 */
export function imageFilesFromClipboard(items: DataTransferItemList): File[] {
  const files: File[] = [];
  for (const item of items) {
    if (item.kind !== 'file') continue;
    if (!item.type.startsWith('image/')) continue;
    const f = item.getAsFile();
    if (f) files.push(f);
  }
  return files;
}
