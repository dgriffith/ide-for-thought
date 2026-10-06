/**
 * Map style selection for the Objects Map view (#2066).
 *
 * Unlike the graph views (`cytoscape-theme.ts`), which build a stylesheet from
 * live Catppuccin CSS tokens, a MapLibre style is a whole pre-built style.json a
 * tile provider hosts — there's no per-property token-building to do. OpenFreeMap
 * (the provider #2064's design spike chose — free, no API key, commercial/bulk use
 * explicitly permitted) ships both light and dark named styles, so theme-awareness
 * here is just URL selection, re-using the same theme-mode helper vega-renderer.ts
 * already calls.
 */
import { getEffectiveTheme, getThemeMode } from '../theme';
import type { MapStyle } from '../../../shared/objects/map-style';

const LIGHT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const DARK_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

/** The OpenFreeMap style URL matching the app's current effective theme.
 *  'contrast' has no dedicated OpenFreeMap style — maps to dark, the safer
 *  default given contrast mode is itself a dark-background theme. */
export function styleUrlForTheme(): string {
  const effective = getEffectiveTheme(getThemeMode());
  return effective === 'light' ? LIGHT_STYLE_URL : DARK_STYLE_URL;
}

/** Which tiles a view's chosen style (#2665) means right now: `light` /
 *  `dark` as chosen, `auto` whatever the app theme maps to. */
export function resolveMapStyle(style: MapStyle): 'light' | 'dark' {
  if (style !== 'auto') return style;
  return styleUrlForTheme() === LIGHT_STYLE_URL ? 'light' : 'dark';
}

/** The style URL for a view's chosen style (#2665). */
export function mapStyleUrl(style: MapStyle): string {
  return resolveMapStyle(style) === 'light' ? LIGHT_STYLE_URL : DARK_STYLE_URL;
}

/** Exports read on white, whatever the app's theme (#2511) — as charts do —
 *  unless the view explicitly chose a style (#2665), which the export keeps:
 *  the map is a captured image, so a dark map is still legible on white. */
export function exportStyleUrl(style: MapStyle = 'auto'): string {
  return style === 'dark' ? DARK_STYLE_URL : LIGHT_STYLE_URL;
}
