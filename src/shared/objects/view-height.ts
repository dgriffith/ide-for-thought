/**
 * An object-view embed's height (#2666): the ```object-view spec's optional
 * `height` field, in CSS px. Omitted means the 360px box every embed had
 * before it could be resized, so existing notes are unchanged — and a resize
 * back to 360 removes the field rather than writing the default.
 *
 * Kept out of `view-spec.ts` / `view-note.ts` on purpose: those carry the
 * view's *contents* (scope, filters, sort), and this is the frame it's drawn
 * in. Pure, so the preview, the export renderer and the source rewrite share
 * one clamp.
 */

import { applyObjectViewField, setSpecField } from './view-spec-field';

export const OBJECT_VIEW_DEFAULT_HEIGHT = 360;
export const OBJECT_VIEW_MIN_HEIGHT = 120;
export const OBJECT_VIEW_MAX_HEIGHT = 2000;

/** Clamp a height to what the embed will draw. */
export function clampViewHeight(n: number): number {
  return Math.min(OBJECT_VIEW_MAX_HEIGHT, Math.max(OBJECT_VIEW_MIN_HEIGHT, Math.round(n)));
}

/** A spec's `height` value as the embed draws it: a number, clamped; anything
 *  else (absent, a string, NaN) is the default. */
export function parseViewHeight(raw: unknown): number {
  return typeof raw === 'number' && Number.isFinite(raw) ? clampViewHeight(raw) : OBJECT_VIEW_DEFAULT_HEIGHT;
}

/** The `height` an embed's spec carries: nothing at the default. */
export function viewHeightField(height: number | null | undefined): number | undefined {
  if (height === null || height === undefined) return undefined;
  const h = clampViewHeight(height);
  return h === OBJECT_VIEW_DEFAULT_HEIGHT ? undefined : h;
}

/**
 * Set (or, with `null` / the default, remove) `height` in an object-view
 * fence's JSON body, touching nothing else (see `view-spec-field.ts`). Returns
 * null for a body that isn't a JSON object.
 */
export function setViewHeightInSpec(body: string, height: number | null): string | null {
  return setSpecField(body, 'height', viewHeightField(height));
}

/**
 * Rewrite the height of the ```object-view fence that opens on `fenceLine`
 * (1-based, in the full content — a fence's `data-fence-line`). Null when that
 * line isn't an object-view fence any more, or its spec isn't JSON.
 */
export function applyObjectViewHeight(content: string, fenceLine: number, height: number | null): string | null {
  return applyObjectViewField(content, fenceLine, 'height', viewHeightField(height));
}
