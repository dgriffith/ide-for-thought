/**
 * Restoring a CodeMirror history snapshot across an Editor remount (#672,
 * extracted from Editor.svelte).
 *
 * When a tab is switched away and back, the EditorView is destroyed and
 * recreated. We persist the serialized CM state (including the undo/redo
 * stacks) and hand it back on remount. CM's serialized state is an opaque
 * blob to us; all we validate is that it carries a string `doc`, which powers
 * the drift check: if the snapshot's document no longer matches the buffer
 * we're mounting (file reloaded from disk, programmatic rewrite, …), the
 * stored stacks would let the user undo to a state the file no longer shows,
 * so we discard them and start from a clean state.
 */

export type HistorySnapshot = { doc: string } & Record<string, unknown>;

/**
 * Validate a raw persisted snapshot down to the minimum shape we rely on
 * (an object with a string `doc`). Anything else → null, meaning "no usable
 * snapshot, start fresh."
 */
export function toHistorySnapshot(raw: unknown): HistorySnapshot | null {
  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  if (typeof obj.doc !== 'string') return null;
  return obj as HistorySnapshot;
}

/**
 * True when `snapshot` can be safely restored against the content we're about
 * to mount — i.e. its doc still matches, so the undo stack is consistent with
 * what's shown. A null snapshot (missing / malformed) is never restorable.
 */
export function canRestoreHistory(
  snapshot: HistorySnapshot | null,
  content: string,
): boolean {
  return snapshot !== null && snapshot.doc === content;
}
