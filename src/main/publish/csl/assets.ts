/**
 * Bundled CSL assets (#247).
 *
 * Vite's `?raw` import inlines the XML as a string at build time, so
 * the published app doesn't need the `bundled/` files on disk. At dev
 * time the files are resolved from the source tree directly.
 */

// @ts-expect-error ?raw imports don't have module declarations, but Vite resolves them to strings.
import APA_CSL from './bundled/apa.csl?raw';
// @ts-expect-error same — see above.
import EN_US_LOCALE from './bundled/locales-en-US.xml?raw';

export const BUNDLED_STYLES: Record<string, string> = {
  apa: APA_CSL as string,
};

export const BUNDLED_LOCALES: Record<string, string> = {
  'en-US': EN_US_LOCALE as string,
};

/** Default style id used when a plan doesn't specify one. */
export const DEFAULT_STYLE = 'apa';
/** Default locale used when a plan doesn't specify one. */
export const DEFAULT_LOCALE = 'en-US';
