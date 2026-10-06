/**
 * A map view's tile style (#2665): `auto` follows the app's appearance (the
 * behaviour every map had before this), `light` / `dark` pin OpenFreeMap's
 * light or dark style for this one view whatever the app theme is.
 *
 * Part of the view spec, so it travels with the tab, the ```object-view
 * fence, Save as note and Copy as markdown. `auto` is the default and is
 * never written out, so an existing spec and a new one that leaves the
 * choice alone serialise identically.
 */
export type MapStyle = 'auto' | 'light' | 'dark';

export const MAP_STYLES: readonly MapStyle[] = ['auto', 'light', 'dark'];

/** Anything that isn't `light` or `dark` — absent, misspelt, wrong type —
 *  reads as `auto`, so a hand-edited fence degrades to today's behaviour
 *  rather than failing to render. */
export function parseMapStyle(raw: unknown): MapStyle {
  return raw === 'light' || raw === 'dark' ? raw : 'auto';
}
