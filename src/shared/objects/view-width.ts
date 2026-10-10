/**
 * An object-view embed's width (#2709): the ```object-view spec's optional
 * `width` field, in CSS px. Omitted means the embed fills the note's reading
 * column, as every embed did before it could be resized — so existing notes
 * are unchanged, and a reset removes the field.
 *
 * Unlike `height` there is no numeric default to write back to: the column's
 * width depends on the window. A stored width wider than there is room for
 * draws at the room there is (the stored value is not rewritten); narrower
 * than the column draws narrower, left-aligned with the text.
 *
 * The frame, not the view's contents — see `view-height.ts` for why it is kept
 * out of `view-spec.ts`.
 */

import { applyObjectViewField, setSpecField } from './view-spec-field';

export const OBJECT_VIEW_MIN_WIDTH = 240;
export const OBJECT_VIEW_MAX_WIDTH = 4000;

/** Clamp a width to what the embed will draw. */
export function clampViewWidth(n: number): number {
  return Math.min(OBJECT_VIEW_MAX_WIDTH, Math.max(OBJECT_VIEW_MIN_WIDTH, Math.round(n)));
}

/** A spec's `width` value as the embed draws it: a number, clamped; anything
 *  else (absent, a string, NaN) is null — fill the column. */
export function parseViewWidth(raw: unknown): number | null {
  return typeof raw === 'number' && Number.isFinite(raw) ? clampViewWidth(raw) : null;
}

/** The `width` an embed's spec carries: nothing when it fills the column. */
export function viewWidthField(width: number | null | undefined): number | undefined {
  return width === null || width === undefined ? undefined : clampViewWidth(width);
}

/** Set (or, with `null`, remove) `width` in an object-view fence's JSON body. */
export function setViewWidthInSpec(body: string, width: number | null): string | null {
  return setSpecField(body, 'width', viewWidthField(width));
}

/** Rewrite the width of the ```object-view fence that opens on `fenceLine`
 *  (1-based). Null when that line isn't an object-view fence any more. */
export function applyObjectViewWidth(content: string, fenceLine: number, width: number | null): string | null {
  return applyObjectViewField(content, fenceLine, 'width', viewWidthField(width));
}
