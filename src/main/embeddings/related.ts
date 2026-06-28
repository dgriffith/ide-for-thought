/**
 * Pure transform from raw chunk hits to the Related panel's list (#838, #839).
 *
 * `relatedToRef` returns chunk-level hits that can repeat a ref across its
 * sections; the panel wants one row per ref (its best-matching section), ranked
 * by score, capped, and enriched with a display title + snippet. Kept separate
 * from the electron-coupled IPC handler so it's unit-testable.
 */

import type { RelatedHit } from './vector-store';
import type { RelatedNote } from '../../shared/types';

export function topRelatedNotes(
  hits: RelatedHit[],
  opts: { limit: number; titleOf: (hit: RelatedHit) => string },
): RelatedNote[] {
  // Best section per (kind, ref).
  const best = new Map<string, RelatedHit>();
  for (const h of hits) {
    const key = `${h.kind}:${h.ref}`;
    const prev = best.get(key);
    if (!prev || h.score > prev.score) best.set(key, h);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit)
    .map((h) => ({
      kind: h.kind,
      ref: h.ref,
      title: opts.titleOf(h),
      sectionHeading: h.sectionHeading,
      snippet: h.chunkText.replace(/\s+/g, ' ').trim().slice(0, 160),
      score: h.score,
    }));
}

/** Flag note hits that are already wiki-linked to the active note (#840), so the
 *  panel can offer a "suggest link" only on unlinked-but-related ones. Non-note
 *  hits are left untouched (they aren't wiki-link targets). */
export function markAlreadyLinked(notes: RelatedNote[], linkedRefs: ReadonlySet<string>): RelatedNote[] {
  return notes.map((n) => (n.kind === 'note' ? { ...n, alreadyLinked: linkedRefs.has(n.ref) } : n));
}
