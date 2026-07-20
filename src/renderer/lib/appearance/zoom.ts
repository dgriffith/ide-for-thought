/**
 * Whole-window zoom as a persisted appearance setting (#...).
 *
 * Zoom scales the entire renderer via Electron's frame zoom factor — the same
 * value the View menu's Actual Size / Zoom In / Zoom Out roles drive. Those
 * menu roles are transient (not persisted); this module adds a persisted
 * preference so a size chosen in Settings survives a restart. `getZoomFactor` /
 * `setZoomFactor` cross the preload bridge to `webFrame` (see `api.view`).
 *
 * Note: the menu's Actual Size (⌘0) resets the live zoom to 100% for the
 * session without clearing the stored preference, so a restart re-applies the
 * stored value — the Settings field is the persistent default; ⌘0 is a
 * temporary reset. The Settings dialog reads the *live* factor when it opens,
 * so the field always reflects what's actually on screen.
 */
import { api } from '../ipc/client';

const STORAGE_KEY = 'zoomFactor';

export const MIN_ZOOM = 0.5;
export const MAX_ZOOM = 2.0;
export const DEFAULT_ZOOM = 1.0;

/** Clamp a zoom factor into the supported [MIN_ZOOM, MAX_ZOOM] range. */
export function clampZoom(factor: number): number {
  if (!Number.isFinite(factor)) return DEFAULT_ZOOM;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, factor));
}

/** The persisted zoom factor, or DEFAULT_ZOOM when nothing valid is stored. */
export function getStoredZoom(): number {
  return clampZoom(parseFloat(localStorage.getItem(STORAGE_KEY) ?? String(DEFAULT_ZOOM)));
}

/** Persist a zoom factor and apply it to the live window. Returns the clamped
 *  value actually applied. */
export function setZoom(factor: number): number {
  const next = clampZoom(factor);
  localStorage.setItem(STORAGE_KEY, String(next));
  api.view.setZoomFactor(next);
  return next;
}

/** Apply the persisted zoom on startup (called from appearance init). */
export function applyStoredZoom(): void {
  api.view.setZoomFactor(getStoredZoom());
}
