/**
 * Pure transform from raw chunk hits to the Related panel's note list (#838).
 *
 * `relatedToNote` returns chunk-level hits that can repeat a note across its
 * sections; the panel wants one row per note (its best-matching section), ranked
 * by score, capped, and enriched with a display title + snippet. Kept separate
 * from the electron-coupled IPC handler so it's unit-testable.
 */

import type { RelatedHit } from './vector-store';
import type { RelatedNote } from '../../shared/types';

export function topRelatedNotes(
  hits: RelatedHit[],
  opts: { limit: number; titleOf: (relativePath: string) => string },
): RelatedNote[] {
  const best = new Map<string, RelatedHit>();
  for (const h of hits) {
    const prev = best.get(h.notePath);
    if (!prev || h.score > prev.score) best.set(h.notePath, h);
  }
  return [...best.values()]
    .sort((a, b) => b.score - a.score)
    .slice(0, opts.limit)
    .map((h) => ({
      relativePath: h.notePath,
      title: opts.titleOf(h.notePath),
      sectionHeading: h.sectionHeading,
      snippet: h.chunkText.replace(/\s+/g, ' ').trim().slice(0, 160),
      score: h.score,
    }));
}
