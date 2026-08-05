/**
 * Strip a broken heading anchor from wiki-links (#1446 — the broken_anchor_link
 * quick-fix). `[[note#missing-heading]]` → `[[note]]`, so the link resolves to
 * the note itself instead of a heading that doesn't exist.
 *
 * Only links that actually resolve to `targetPath` AND whose anchor slugifies to
 * `anchorSlug` are touched — so a `#intro` that's broken on note A never strips
 * a valid `#intro` on note B. Type prefix and display text are preserved.
 */
import { WIKI_LINK_RE, parseWikiInner, reassembleWikiLink } from '../wiki-link';
import { resolveWikiLinkTarget, type NoteFileLike } from '../wiki-link-resolver';
import { getLinkType } from '../link-types';
import { slugify } from '../slug';

export function removeBrokenAnchorLinks(
  content: string,
  files: NoteFileLike[],
  aliases: Record<string, string> | undefined,
  targetPath: string,
  anchorSlug: string,
): string {
  return content.replace(WIKI_LINK_RE, (whole, inner: string) => {
    const p = parseWikiInner(inner);
    if (!p.anchor) return whole;
    // `p.anchor` keeps its leading '#'; the inspection's anchor is already a slug.
    const raw = p.anchor.slice(1);
    if (raw.startsWith('^')) return whole; // block-id, not a heading
    if (slugify(raw) !== anchorSlug) return whole;
    // cite:: / quote:: target sources / excerpts, not notes — leave them.
    if (p.type && getLinkType(p.type).targetKind !== undefined) return whole;
    if (resolveWikiLinkTarget(p.target, files, aliases) !== targetPath) return whole;
    return reassembleWikiLink({ ...p, anchor: null }, p.target);
  });
}
