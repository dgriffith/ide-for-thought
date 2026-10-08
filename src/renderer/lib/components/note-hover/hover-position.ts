/**
 * Where a `NoteHoverPreview` goes (#2710): under its anchor, left edges
 * aligned, as the Preview pane's link hover sat (#1132) — above it instead
 * when there's no room below — and always inside the window, `MARGIN` from
 * every edge. Viewport coordinates, for a `position: fixed` element.
 */

/** Gap between the anchor and the preview. */
export const GAP = 6;
/** Closest the preview comes to a window edge. */
export const MARGIN = 8;

export interface Box { left: number; top: number; width: number; height: number }

export function placeHover(anchor: Box, size: { width: number; height: number }, viewport: { width: number; height: number }): { left: number; top: number } {
  const below = anchor.top + anchor.height + GAP;
  const above = anchor.top - GAP - size.height;
  const fitsBelow = below + size.height <= viewport.height - MARGIN;
  const top = fitsBelow || above < MARGIN ? Math.max(MARGIN, Math.min(below, viewport.height - MARGIN - size.height)) : above;
  const left = Math.max(MARGIN, Math.min(anchor.left, viewport.width - MARGIN - size.width));
  return { left: Math.round(left), top: Math.round(top) };
}
