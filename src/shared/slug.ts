/**
 * Slugify a heading or anchor string into the ID we use in link URIs and
 * in the HTML heading `id` attribute.
 *
 * Rules:
 * - Lowercase.
 * - Strip anything that isn't a word char, a space, or an unambiguous ASCII
 *   hyphen (the `^` is preserved so block-id anchors like `#^abc` keep their
 *   marker when a caller chooses to slugify a full anchor).
 * - Collapse whitespace runs into a single `-`.
 * - Collapse multiple hyphens.
 * - Trim leading/trailing hyphens.
 *
 * Idempotent: `slugify(slugify(x)) === slugify(x)` for all x.
 */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s\-^]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/**
 * Split a wiki-link target at the first `#` into its path and anchor parts.
 * `anchor` is the text AFTER the `#` (no leading hash). For block-id links,
 * the returned anchor still begins with `^` so callers can distinguish.
 * Returns `{ path: target, anchor: null }` if no hash is present.
 */
export function splitAnchor(target: string): { path: string; anchor: string | null } {
  const idx = target.indexOf('#');
  if (idx < 0) return { path: target, anchor: null };
  return { path: target.slice(0, idx), anchor: target.slice(idx + 1) };
}
