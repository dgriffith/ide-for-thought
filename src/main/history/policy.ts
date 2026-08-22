/**
 * Local per-note history — capture + retention POLICY (#1158, Job 1 of the
 * versioning epic #1157). Pure logic, no I/O, so the rules that decide "does
 * this save become a new revision?" and "which revisions age out?" are unit-
 * testable in isolation. The store (`store.ts`) applies these to disk.
 *
 * Design note: capture is APPEND-ONLY (dedupe identical content, never replace).
 * A lossy "coalesce recent saves" rule would let an accidental delete overwrite
 * the snapshot of the good content it replaced — defeating the whole point of a
 * recovery feature. Notes are small text, so we keep every distinct saved state
 * within the retention window and treat timeline density as a display concern.
 */

import type { RevisionMeta } from '../../shared/history';
export type { RevisionMeta, RevisionOrigin, RevisionSource } from '../../shared/history';

/** Keep a note's history at most this many days (unlabeled). */
export const RETENTION_DAYS = 30;
/** Hard cap on unlabeled revisions per note, so a marathon editing session
 *  can't grow one note's history without bound. Generous — notes are small. */
export const MAX_REVISIONS_PER_NOTE = 500;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Decide whether a save becomes a new revision. Append unless the content is
 * byte-identical to the most recent revision's content (a no-op save / a
 * re-save of unchanged text). `latestContent` is undefined when the note has no
 * history yet.
 */
export function shouldCapture(newContent: string, latestContent: string | undefined): boolean {
  return newContent !== latestContent;
}

/**
 * Split a note's revisions (any order) into the ones to keep and the ones to
 * prune. Pruned when OLDER than the retention window, or beyond the newest
 * `MAX_REVISIONS_PER_NOTE` — but a LABELED revision is never pruned (an
 * explicitly-marked version is a deliberate keepsake). Returns newest-first
 * `kept` and the `removed` set.
 */
export function selectForRetention(
  revisions: RevisionMeta[],
  now: number,
  opts: { retentionDays?: number; maxPerNote?: number } = {},
): { kept: RevisionMeta[]; removed: RevisionMeta[] } {
  const retentionDays = opts.retentionDays ?? RETENTION_DAYS;
  const maxPerNote = opts.maxPerNote ?? MAX_REVISIONS_PER_NOTE;
  const cutoff = now - retentionDays * DAY_MS;

  const byNewest = [...revisions].sort((a, b) => b.ts - a.ts);
  const kept: RevisionMeta[] = [];
  const removed: RevisionMeta[] = [];
  let unlabeledKept = 0;

  for (const rev of byNewest) {
    if (rev.label) { kept.push(rev); continue; } // labeled: always survives
    const tooOld = rev.ts < cutoff;
    const overCap = unlabeledKept >= maxPerNote;
    if (tooOld || overCap) { removed.push(rev); continue; }
    kept.push(rev);
    unlabeledKept++;
  }
  return { kept, removed };
}
