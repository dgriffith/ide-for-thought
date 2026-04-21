/**
 * Wiki-link parsing primitives shared between the indexer's rewriting code
 * and the formatter's Minerva-specific rules.
 *
 * A wiki-link has four optional parts: `[[type::target#anchor|display]]`.
 * None of these helpers touch the document around the link; callers slot
 * the reassembled string back in themselves.
 */

export const WIKI_LINK_RE = /\[\[([^\]\n]+?)\]\]/g;

export interface ParsedWikiLink {
  /** Type prefix like `supports` or `cite`, or null if untyped. */
  type: string | null;
  /** Bare path/id portion (no anchor, no display, no type prefix). */
  target: string;
  /** Original anchor including the `#` prefix, or null if absent. */
  anchor: string | null;
  /** Display text after `|`, or null if absent. */
  display: string | null;
}

export function parseWikiInner(inner: string): ParsedWikiLink {
  const pipeIdx = inner.indexOf('|');
  const head = pipeIdx >= 0 ? inner.slice(0, pipeIdx) : inner;
  const display = pipeIdx >= 0 ? inner.slice(pipeIdx + 1) : null;

  const typeMatch = head.match(/^([a-z][\w-]*)::(.*)$/);
  const type = typeMatch ? typeMatch[1] : null;
  const rest = typeMatch ? typeMatch[2] : head;

  const hashIdx = rest.indexOf('#');
  const target = hashIdx >= 0 ? rest.slice(0, hashIdx) : rest;
  const anchor = hashIdx >= 0 ? rest.slice(hashIdx) : null;

  return { type, target: target.trim(), anchor, display };
}

export function reassembleWikiLink(parsed: ParsedWikiLink, newTarget: string): string {
  const typeText = parsed.type ? `${parsed.type}::` : '';
  const anchorText = parsed.anchor ?? '';
  const displayText = parsed.display !== null ? `|${parsed.display}` : '';
  return `[[${typeText}${newTarget}${anchorText}${displayText}]]`;
}
