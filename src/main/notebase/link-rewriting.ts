/**
 * Rewrite wiki-link targets inside markdown content.
 *
 * Given a `rewrites` map of normalized old-path → new-path (no `.md`
 * suffix on either side), walk every `[[…]]` token in the content and
 * substitute matching targets while preserving:
 *
 *   - type prefix       `[[type::old]]`     → `[[type::new]]`
 *   - display text      `[[old|label]]`     → `[[new|label]]`
 *   - anchor suffix     `[[old#heading]]`   → `[[new#heading]]`
 *   - `.md` extension   `[[old.md]]`        → `[[new.md]]`
 *
 * Non-matching links, typed links pointing at sources/excerpts
 * (`[[cite::foo]]`, `[[quote::bar]]`), and tokens that don't look
 * like wiki-links at all are left untouched.
 */

import { WIKI_LINK_RE, parseWikiInner, reassembleWikiLink } from '../../shared/wiki-link';

/** Strip a trailing `.md` extension so rewrite keys match the indexer's convention. */
export function normalizePath(p: string): string {
  return p.replace(/\.md$/, '');
}

/**
 * Apply a rewrites map to all wiki-link targets in the content.
 * Returns the rewritten content (unchanged if nothing matched).
 */
export function rewriteWikiLinks(content: string, rewrites: Map<string, string>): string {
  if (rewrites.size === 0) return content;
  return content.replace(WIKI_LINK_RE, (match: string, inner: string) => {
    const parsed = parseWikiInner(inner);
    // Typed links that target non-notes (cite/quote) are out of scope —
    // their targets are ids, not paths. Skip them.
    if (parsed.type === 'cite' || parsed.type === 'quote') return match;

    const normalized = normalizePath(parsed.target);
    const newPath = rewrites.get(normalized);
    if (newPath === undefined) return match;

    const hadExtension = parsed.target.endsWith('.md');
    const finalTarget = hadExtension ? `${newPath}.md` : newPath;
    return reassembleWikiLink(parsed, finalTarget);
  });
}

/**
 * Rewrite the target id of every `[[<linkTypeName>::id]]` link whose id
 * appears in the rewrites map. Used for cite/quote renames where the
 * target is an id (not a path) and the type prefix is required to match.
 * Preserves anchor and display.
 */
export function rewriteTypedIdLinks(
  content: string,
  linkTypeName: string,
  rewrites: Map<string, string>,
): string {
  if (rewrites.size === 0) return content;
  return content.replace(WIKI_LINK_RE, (match: string, inner: string) => {
    const parsed = parseWikiInner(inner);
    if (parsed.type !== linkTypeName) return match;
    const newId = rewrites.get(parsed.target);
    if (newId === undefined) return match;
    return reassembleWikiLink(parsed, newId);
  });
}

/**
 * Rewrite the anchor portion of every wiki-link whose target path matches
 * `targetPath` (normalized) AND whose anchor equals `oldAnchor`. Preserves
 * the target path (including `.md` extension shape), the type prefix, and
 * the display text. Used when a heading in `targetPath` is renamed.
 */
export function rewriteAnchorInLinks(
  content: string,
  targetPath: string,
  oldAnchor: string,
  newAnchor: string,
): string {
  const normalizedTarget = normalizePath(targetPath);
  return content.replace(WIKI_LINK_RE, (match: string, inner: string) => {
    const parsed = parseWikiInner(inner);
    if (parsed.type === 'cite' || parsed.type === 'quote') return match;
    if (normalizePath(parsed.target) !== normalizedTarget) return match;
    // Compare without the leading `#` so callers can pass slugs directly.
    const currentAnchor = parsed.anchor?.startsWith('#') ? parsed.anchor.slice(1) : parsed.anchor;
    if (currentAnchor !== oldAnchor) return match;
    // Reassemble with the new anchor.
    const newAnchorText = newAnchor ? `#${newAnchor}` : '';
    const rewritten: typeof parsed = { ...parsed, anchor: newAnchorText || null };
    return reassembleWikiLink(rewritten, parsed.target);
  });
}
