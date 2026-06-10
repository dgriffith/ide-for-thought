/**
 * Reading-queue updates (#116).
 *
 * A source carries an optional `minerva:readStatus` enum and an optional
 * `minerva:readDueBy` date in its `meta.ttl`. Setting either is a single-valued
 * predicate upsert + re-index, now shared with the source-property approval
 * path (#103) via `source-meta-write.ts`.
 */

import type { ReadStatus } from '../../shared/types';
import { setSourceProperties, ttlString } from './source-meta-write';

const VALID: ReadonlySet<ReadStatus> = new Set(['unread', 'reading', 'read', 'skipped']);

export function isReadStatus(value: unknown): value is ReadStatus {
  return typeof value === 'string' && VALID.has(value as ReadStatus);
}

/** Set, change, or clear a source's read status. `null` removes the
 *  predicate entirely (i.e. the source goes back to "no status set"). */
export async function setSourceReadStatus(
  rootPath: string,
  sourceId: string,
  status: ReadStatus | null,
): Promise<void> {
  if (status !== null && !isReadStatus(status)) {
    throw new Error(`Invalid read status: ${String(status)}`);
  }
  await setSourceProperties(rootPath, sourceId, [
    { predicate: 'minerva:readStatus', value: status === null ? null : ttlString(status) },
  ]);
}

/** Set, change, or clear a source's due-by date. ISO date string
 *  (`YYYY-MM-DD`); `null` removes the predicate. */
export async function setSourceReadDueBy(
  rootPath: string,
  sourceId: string,
  dueBy: string | null,
): Promise<void> {
  if (dueBy !== null && !/^\d{4}-\d{2}-\d{2}$/.test(dueBy)) {
    throw new Error(`Invalid ISO date for readDueBy: ${dueBy}`);
  }
  await setSourceProperties(rootPath, sourceId, [
    { predicate: 'minerva:readDueBy', value: dueBy === null ? null : `${ttlString(dueBy)}^^xsd:date` },
  ]);
}
