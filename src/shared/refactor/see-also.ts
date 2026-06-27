/**
 * Append a wiki-link to a note's "See also" section (#840).
 *
 * Semantic "suggested links" connect two notes that are *about the same thing*
 * — but, unlike AutoLink (#589), they often share no anchor word to link inline.
 * So a suggestion is filed as a bullet under a `## See also` section (created at
 * the end if absent), the conventional home for "related, but not referenced in
 * the prose" links. Pure + idempotent so it's trivially testable.
 */

const SEE_ALSO_HEADING = 'See also';

/** Canonical wiki-link text for a target note path — its path stem, matching
 *  AutoLink's `[[stem]]` form (unambiguous; the resolver also accepts basenames). */
export function wikiLinkStem(targetRelPath: string): string {
  return targetRelPath.replace(/\.md$/i, '');
}

export interface SeeAlsoResult {
  content: string;
  /** False when the link was already present (nothing changed). */
  changed: boolean;
}

/**
 * Add `- [[stem]]` under the note's `## See also` section. Creates the section
 * at the end of the note if it doesn't exist. No-op if a link to the same target
 * already exists anywhere in the note (linked once is enough).
 */
export function appendSeeAlsoLink(content: string, targetRelPath: string): SeeAlsoResult {
  const stem = wikiLinkStem(targetRelPath);

  // Already linked anywhere (inline or in See-also)? Then we're done.
  if (hasWikiLinkTo(content, stem)) return { content, changed: false };

  const bullet = `- [[${stem}]]`;
  const heading = findSeeAlsoHeading(content);

  if (heading) {
    // Insert the bullet at the end of the existing section (before the next
    // heading, or at end of file).
    const insertAt = sectionEnd(content, heading.bodyStart);
    const before = content.slice(0, insertAt).replace(/\s*$/, '');
    const after = content.slice(insertAt);
    return { content: `${before}\n${bullet}\n${after.replace(/^\n+/, '')}`.replace(/\n+$/, '\n'), changed: true };
  }

  // No section — append one. Ensure exactly one blank line before it.
  const base = content.replace(/\s*$/, '');
  const sep = base.length > 0 ? '\n\n' : '';
  return { content: `${base}${sep}## ${SEE_ALSO_HEADING}\n\n${bullet}\n`, changed: true };
}

/** True if `[[stem]]` or `[[stem|display]]` (or `[[stem#anchor]]`) already exists. */
function hasWikiLinkTo(content: string, stem: string): boolean {
  const esc = stem.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`\\[\\[${esc}(?:[#|][^\\]]*)?\\]\\]`).test(content);
}

interface HeadingLoc { bodyStart: number }

/** Locate an existing `## See also` heading (any level, case-insensitive),
 *  returning where its body begins. */
function findSeeAlsoHeading(content: string): HeadingLoc | null {
  const re = new RegExp(`^#{1,6}\\s+${SEE_ALSO_HEADING}\\s*$`, 'im');
  const m = re.exec(content);
  if (!m) return null;
  const lineEnd = content.indexOf('\n', m.index);
  return { bodyStart: lineEnd === -1 ? content.length : lineEnd + 1 };
}

/** End offset of a section: the start of the next ATX heading at/after
 *  `bodyStart`, or end of file. */
function sectionEnd(content: string, bodyStart: number): number {
  const re = /^#{1,6}\s+/m;
  re.lastIndex = bodyStart;
  const rest = content.slice(bodyStart);
  const m = /\n#{1,6}\s+/.exec(rest);
  return m ? bodyStart + m.index + 1 : content.length;
}
