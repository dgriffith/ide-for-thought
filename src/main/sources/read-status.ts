/**
 * Reading-queue updates (#116).
 *
 * A source carries an optional `minerva:readStatus` enum and an
 * optional `minerva:readDueBy` date in its `meta.ttl`. Setting either
 * is a small text mutation: drop any existing line for the predicate,
 * insert a fresh one before the closing `.`, then re-index so the
 * graph and SourceMetadata reflect the new value.
 *
 * Same shape as the metadata-merge in #90 part 1 — we control the
 * writer (`buildMetaTtl`) and the predicate is single-valued, so a
 * line-oriented regex pass is reliable for our own output and tolerant
 * of hand edits.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import type { ReadStatus } from '../../shared/types';

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
  const metaPath = sourceMetaPath(rootPath, sourceId);
  const ttl = await readMeta(metaPath);
  const next = upsertSingleValuedPredicate(
    ttl,
    'minerva:readStatus',
    status === null ? null : `${ttlString(status)}`,
  );
  if (next === ttl) return;
  await fs.writeFile(metaPath, next, 'utf-8');
  await reindexSource(rootPath, sourceId);
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
  const metaPath = sourceMetaPath(rootPath, sourceId);
  const ttl = await readMeta(metaPath);
  const next = upsertSingleValuedPredicate(
    ttl,
    'minerva:readDueBy',
    dueBy === null ? null : `${ttlString(dueBy)}^^xsd:date`,
  );
  if (next === ttl) return;
  await fs.writeFile(metaPath, next, 'utf-8');
  await reindexSource(rootPath, sourceId);
}

function sourceMetaPath(rootPath: string, sourceId: string): string {
  return path.join(rootPath, '.minerva', 'sources', sourceId, 'meta.ttl');
}

async function readMeta(metaPath: string): Promise<string> {
  try {
    return await fs.readFile(metaPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Source meta.ttl not found: ${metaPath}`, { cause: err });
    }
    throw err;
  }
}

async function reindexSource(rootPath: string, sourceId: string): Promise<void> {
  const ctx = projectContext(rootPath);
  const ttl = await readMeta(sourceMetaPath(rootPath, sourceId));
  let body: string | undefined;
  try {
    body = await fs.readFile(path.join(rootPath, '.minerva', 'sources', sourceId, 'body.md'), 'utf-8');
  } catch { /* body optional */ }
  graph.indexSource(ctx, sourceId, ttl, body);
}

/**
 * Replace a single-valued predicate's value, or insert a fresh line
 * before the closing `.` when the predicate is absent. Passing
 * `null` for `value` deletes the predicate line entirely.
 *
 * Match scope: a whole TTL line whose first non-whitespace token is
 * the prefixed predicate (`prefix:local`). We don't try to handle
 * comma-continuations because our writer never emits them.
 */
export function upsertSingleValuedPredicate(
  ttl: string,
  predicate: string,
  value: string | null,
): string {
  const escaped = predicate.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // Capture the indentation so we re-emit with the same shape.
  const re = new RegExp(`^([ \\t]*)${escaped}\\s+[^\\n]*\\n?`, 'm');
  const hadMatch = re.test(ttl);
  if (hadMatch) {
    if (value === null) {
      // Delete the line. Take care: if the line we delete was the
      // last predicate, the previous `;` becomes a stray separator.
      // Cheap fix: after removal, ensure the line above the final
      // `.` still ends with `;`.
      const removed = ttl.replace(re, '');
      return normaliseTrailingSeparator(removed);
    }
    return ttl.replace(re, (_match, indent: string) => `${indent}${predicate} ${value} ;\n`);
  }
  if (value === null) return ttl; // nothing to delete
  return insertBeforeFinalDot(ttl, `    ${predicate} ${value} ;`);
}

/**
 * After deleting a predicate line, the new line that now precedes
 * the final `.` must terminate with `;` (since the deleted line had
 * been the `.`-bearing one, or a middle `;`-terminated line). The
 * existing writer always emits `; ;… .`, so as long as every
 * non-final predicate ends with `;` we're well-formed. This walks
 * back from the final `.` and replaces a stray trailing `;` on the
 * predicate that's now the last with `.`.
 *
 * Concretely: when the writer originally produced
 *   foo ;
 *   readStatus ... ;
 *   bar .
 * and we remove the readStatus line, we get
 *   foo ;
 *   bar .
 * which is already well-formed — every line ending the same as
 * before. So this function is mostly a safety net for the edge
 * case where the predicate we deleted was the bottom-most one.
 */
function normaliseTrailingSeparator(ttl: string): string {
  // Find the trailing `.`
  const trailing = ttl.match(/(\s*\.\s*)$/);
  if (!trailing) return ttl;
  const dotIdx = trailing.index ?? ttl.length;
  // Walk back to the previous newline.
  const lineStart = ttl.lastIndexOf('\n', dotIdx - 1);
  if (lineStart < 0) return ttl;
  const lineBefore = ttl.slice(lineStart + 1, dotIdx);
  // If the line before the `.` ends with `;`, switch it to `.` and
  // drop the dangling `.`.
  const trimmed = lineBefore.replace(/\s+$/, '');
  if (trimmed.endsWith(';')) {
    const fixed = trimmed.slice(0, -1).replace(/\s+$/, '') + ' .';
    return ttl.slice(0, lineStart + 1) + fixed + '\n';
  }
  return ttl;
}

/**
 * Insert a new predicate line immediately before the closing `.`.
 * The writer always emits `... ;\n    pred value .\n`, so the line
 * preceding the `.` already ends with `;` and we can safely splice
 * a new `;`-terminated predicate before it without rewriting
 * separators.
 *
 * Mirrors the technique in source-merge.ts; kept local because the
 * matching semantics differ slightly (single line, not a batch).
 */
function insertBeforeFinalDot(ttl: string, newLine: string): string {
  const trailing = ttl.match(/(\s*\.\s*)$/);
  if (!trailing) {
    // Malformed TTL — append + close.
    return ttl + (ttl.endsWith('\n') ? '' : '\n') + newLine + '\n    .\n';
  }
  const dotIdx = trailing.index ?? ttl.length;
  const lineStart = ttl.lastIndexOf('\n', dotIdx - 1);
  if (lineStart < 0) {
    return ttl.slice(0, dotIdx).replace(/\s+$/, ' ;') + '\n' + newLine + '\n' + ttl.slice(dotIdx);
  }
  return ttl.slice(0, lineStart) + '\n' + newLine + ttl.slice(lineStart);
}

function ttlString(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}
