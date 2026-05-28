/**
 * User-facing display label for a Source.
 *
 * Source ids on disk follow a canonical format (`url-<hash>`,
 * `doi-10.xxxx_yyyy`, `sha-<hash>`, …) chosen for filesystem
 * stability — never for human reading. Anywhere a source's name
 * shows up in the UI (tab heading, sidebar row, picker, etc.) should
 * route through this helper so a raw `url-abc123def456` never reaches
 * the user.
 *
 * Priority:
 *   1. `meta.title`        (the usual case after a successful ingest)
 *   2. cleaned `meta.uri`  (hostname + path — readable, identifies
 *                          the page even when the fetch didn't get
 *                          a title)
 *   3. `DOI 10.xxxx/yyyy`  (for sources that have a DOI but no title)
 *   4. `"Untitled source"` (the honest fallback — better than exposing
 *                          the canonical id, which is not addressable
 *                          information for the user)
 */
export interface SourceTitleSource {
  title: string | null;
  uri: string | null;
  doi: string | null;
}

export function displaySourceTitle(meta: SourceTitleSource): string {
  if (meta.title && meta.title.trim().length > 0) return meta.title.trim();
  if (meta.uri) return cleanUrlForDisplay(meta.uri);
  if (meta.doi) return `DOI ${meta.doi}`;
  return 'Untitled source';
}

/**
 * Strip the scheme + leading `www.` and the query string from a URL,
 * leaving a compact identifier the user can recognise. Falls back to
 * the raw string when the URL doesn't parse.
 */
function cleanUrlForDisplay(uri: string): string {
  try {
    const u = new URL(uri);
    const host = u.hostname.replace(/^www\./, '');
    const path = u.pathname && u.pathname !== '/' ? u.pathname.replace(/\/$/, '') : '';
    return host + path;
  } catch {
    return uri;
  }
}
