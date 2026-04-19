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

const WIKI_LINK_RE = /\[\[([^\]\n]+?)\]\]/g;

interface ParsedWikiLink {
  /** Type prefix like `supports` or `cite`, or null if untyped. */
  type: string | null;
  /** Bare path/id portion (no anchor, no display, no type prefix). */
  target: string;
  /** Original anchor including the `#` prefix, or null if absent. */
  anchor: string | null;
  /** Display text after `|`, or null if absent. */
  display: string | null;
}

function parseWikiInner(inner: string): ParsedWikiLink {
  // Split off display (|)
  const pipeIdx = inner.indexOf('|');
  const head = pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner;
  const display = pipeIdx >= 0 ? inner.slice(pipeIdx + 1) : null;

  // Split off type::
  const typeMatch = head.match(/^([a-z][\w-]*)::(.*)$/);
  const type = typeMatch ? typeMatch[1] : null;
  const rest = typeMatch ? typeMatch[2] : head;

  // Split off #anchor (everything from # onward, preserving block-id `^`)
  const hashIdx = rest.indexOf('#');
  const target = hashIdx >= 0 ? rest.slice(0, hashIdx) : rest;
  const anchor = hashIdx >= 0 ? rest.slice(hashIdx) : null;

  return { type, target: target.trim(), anchor, display };
}

function reassembleWikiLink(parsed: ParsedWikiLink, newTarget: string): string {
  const typeText = parsed.type ? `${parsed.type}::` : '';
  const anchorText = parsed.anchor ?? '';
  const displayText = parsed.display !== null ? `|${parsed.display}` : '';
  return `[[${typeText}${newTarget}${anchorText}${displayText}]]`;
}

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
  return content.replace(WIKI_LINK_RE, (match, inner) => {
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
  return content.replace(WIKI_LINK_RE, (match, inner) => {
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
  return content.replace(WIKI_LINK_RE, (match, inner) => {
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
