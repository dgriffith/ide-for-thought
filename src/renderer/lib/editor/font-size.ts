/**
 * Editor font-size bounds + pure helpers (#672, extracted from Editor.svelte).
 *
 * The size is persisted in localStorage under `editorFontSize`; the component
 * owns that I/O and the CM theme reconfiguration, while these pure helpers own
 * the clamping and the stored-value parse so they can be unit-tested without a
 * DOM or a live EditorView.
 */

export const MIN_FONT = 10;
export const MAX_FONT = 24;
export const DEFAULT_FONT = 14;

/** Clamp a font size into the supported [MIN_FONT, MAX_FONT] range. */
export function clampFontSize(size: number): number {
  return Math.max(MIN_FONT, Math.min(MAX_FONT, size));
}

/**
 * Parse a stored font-size string into a number, falling back to DEFAULT_FONT
 * when nothing is stored. Mirrors the prior inline `getFontSize()` (a bare
 * `parseInt(… ?? DEFAULT)`): a present-but-garbage value parses the way
 * `parseInt` would, and the caller clamps before applying.
 */
export function parseStoredFontSize(raw: string | null): number {
  return parseInt(raw ?? String(DEFAULT_FONT), 10);
}
