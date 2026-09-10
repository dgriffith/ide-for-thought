/**
 * Client-side preview of a multi-file history revert (#2092) — built on the
 * same pure `resolveAsOf` primitive the backend uses
 * (`main/notebase/multi-file-history.ts`'s `batchRevertToPointInTime`), so the
 * dialog can show "here's what will happen" from the already-loaded timeline
 * before the user commits, with no extra IPC round-trip.
 *
 * This is advisory, not authoritative: it approximates the backend's five
 * buckets from revision metadata alone (no content hashing), so a revert
 * whose target content happens to match the current text some other way
 * still reads as `reverted` here. `batchRevertToPointInTime`'s own result is
 * what the completion summary reports.
 */
import { resolveAsOf, type UnifiedTimelineEntry, type BatchRevertResult } from '../../../shared/history';

export type PreviewBucket = keyof Omit<BatchRevertResult, 'ts' | 'errors'>;

export interface PathPreview {
  path: string;
  bucket: PreviewBucket;
}

/** Preview every path appearing in `timeline` as of `ts`, sorted by path. */
export function previewRevert(timeline: UnifiedTimelineEntry[], ts: number): PathPreview[] {
  const byPath = new Map<string, UnifiedTimelineEntry[]>();
  for (const entry of timeline) {
    const list = byPath.get(entry.path);
    if (list) list.push(entry);
    else byPath.set(entry.path, [entry]);
  }

  const out: PathPreview[] = [];
  for (const [path, entries] of byPath) {
    const target = resolveAsOf(entries, ts);

    let latestOverall: UnifiedTimelineEntry | null = null;
    let latestPresent: UnifiedTimelineEntry | null = null;
    for (const entry of entries) {
      if (!latestOverall || entry.ts > latestOverall.ts) latestOverall = entry;
      if (entry.origin !== 'delete' && (!latestPresent || entry.ts > latestPresent.ts)) latestPresent = entry;
    }
    const currentlyDeleted = latestOverall?.origin === 'delete';

    let bucket: PreviewBucket;
    if (target === 'absent') {
      bucket = currentlyDeleted ? 'skipped' : 'removed';
    } else if (target === 'deleted') {
      bucket = currentlyDeleted ? 'unchanged' : 'removed';
    } else if (currentlyDeleted) {
      bucket = 'recreated';
    } else {
      bucket = latestPresent?.ts === target.ts ? 'unchanged' : 'reverted';
    }

    out.push({ path, bucket });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}
