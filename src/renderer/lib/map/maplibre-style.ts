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

const LIGHT_STYLE_URL = 'https://tiles.openfreemap.org/styles/liberty';
const DARK_STYLE_URL = 'https://tiles.openfreemap.org/styles/dark';

/** The OpenFreeMap style URL matching the app's current effective theme.
 *  'contrast' has no dedicated OpenFreeMap style — maps to dark, the safer
 *  default given contrast mode is itself a dark-background theme. */
export function styleUrlForTheme(): string {
  const effective = getEffectiveTheme(getThemeMode());
  return effective === 'light' ? LIGHT_STYLE_URL : DARK_STYLE_URL;
}
