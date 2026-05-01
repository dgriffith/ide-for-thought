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
import CHICAGO_AD_CSL from './bundled/chicago-author-date.csl?raw';
// @ts-expect-error same — see above.
import CHICAGO_NOTES_CSL from './bundled/chicago-notes-bibliography.csl?raw';
// @ts-expect-error same — see above.
import IEEE_CSL from './bundled/ieee.csl?raw';
// @ts-expect-error same — see above.
import MLA_CSL from './bundled/modern-language-association.csl?raw';
// @ts-expect-error same — see above.
import VANCOUVER_CSL from './bundled/vancouver.csl?raw';
// @ts-expect-error same — see above.
import EN_US_LOCALE from './bundled/locales-en-US.xml?raw';

export const BUNDLED_STYLES: Record<string, string> = {
  apa: APA_CSL as string,
  'chicago-author-date': CHICAGO_AD_CSL as string,
  'chicago-notes-bibliography': CHICAGO_NOTES_CSL as string,
  ieee: IEEE_CSL as string,
  mla: MLA_CSL as string,
  vancouver: VANCOUVER_CSL as string,
};

/** Human-readable labels for each bundled style id, for UI pickers. */
export const BUNDLED_STYLE_LABELS: Record<string, string> = {
  apa: 'APA (7th edition)',
  'chicago-author-date': 'Chicago (author–date)',
  'chicago-notes-bibliography': 'Chicago (notes & bibliography)',
  ieee: 'IEEE',
  mla: 'MLA (9th edition)',
  vancouver: 'Vancouver (NLM citation-sequence)',
};

export const BUNDLED_LOCALES: Record<string, string> = {
  'en-US': EN_US_LOCALE as string,
};

/** Default style id used when a plan doesn't specify one. */
export const DEFAULT_STYLE = 'apa';
/** Default locale used when a plan doesn't specify one. */
export const DEFAULT_LOCALE = 'en-US';
