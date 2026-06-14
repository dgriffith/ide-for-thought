/**
 * Single-predicate writers for a source's `meta.ttl` (#103).
 *
 * Extracted from `read-status.ts` (#116), which pioneered the line-oriented
 * upsert: drop any existing line for a single-valued predicate, insert a fresh
 * one before the closing `.`, then re-index. We control the writer
 * (`buildMetaTtl`), the predicates are single-valued, and meta.ttl files carry
 * no `@prefix` block (standard prefixes are injected at index time), so a
 * line-regex pass is reliable for our own output and tolerant of hand edits.
 *
 * `read-status.ts` and the source-property approval path (#103) both build on
 * these — keep them dependency-free of any one feature's semantics.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';

export function sourceMetaPath(rootPath: string, sourceId: string): string {
  return path.join(rootPath, '.minerva', 'sources', sourceId, 'meta.ttl');
}

export async function readMeta(metaPath: string): Promise<string> {
  try {
    return await fs.readFile(metaPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new Error(`Source meta.ttl not found: ${metaPath}`, { cause: err });
    }
    throw err;
  }
}

export async function reindexSource(rootPath: string, sourceId: string): Promise<void> {
  const ctx = projectContext(rootPath);
  const ttl = await readMeta(sourceMetaPath(rootPath, sourceId));
  let body: string | undefined;
  try {
    body = await fs.readFile(path.join(rootPath, '.minerva', 'sources', sourceId, 'body.md'), 'utf-8');
  } catch { /* body optional */ }
  graph.indexSource(ctx, sourceId, ttl, body);
}

/**
 * Replace a single-valued predicate's value, or insert a fresh line before the
 * closing `.` when the predicate is absent. Passing `null` for `value` deletes
 * the predicate line entirely.
 *
 * Match scope: a whole TTL line whose first non-whitespace token is the
 * prefixed predicate (`prefix:local`). We don't handle comma-continuations
 * because our writer never emits them.
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
      const removed = ttl.replace(re, '');
      return normaliseTrailingSeparator(removed);
    }
    return ttl.replace(re, (_match, indent: string) => `${indent}${predicate} ${value} ;\n`);
  }
  if (value === null) return ttl; // nothing to delete
  return insertBeforeFinalDot(ttl, `    ${predicate} ${value} ;`);
}

/**
 * After deleting a predicate line, the new line that now precedes the final `.`
 * must terminate with `;`. The writer always emits `; ;… .`, so as long as
 * every non-final predicate ends with `;` we're well-formed. This walks back
 * from the final `.` and fixes a stray trailing `;` on the now-last predicate.
 */
function normaliseTrailingSeparator(ttl: string): string {
  const trailing = ttl.match(/(\s*\.\s*)$/);
  if (!trailing) return ttl;
  const dotIdx = trailing.index ?? ttl.length;
  const lineStart = ttl.lastIndexOf('\n', dotIdx - 1);
  if (lineStart < 0) return ttl;
  const lineBefore = ttl.slice(lineStart + 1, dotIdx);
  const trimmed = lineBefore.replace(/\s+$/, '');
  if (trimmed.endsWith(';')) {
    const fixed = trimmed.slice(0, -1).replace(/\s+$/, '') + ' .';
    return ttl.slice(0, lineStart + 1) + fixed + '\n';
  }
  return ttl;
}

/**
 * Insert a new predicate line immediately before the closing `.`. The writer
 * always emits `... ;\n    pred value .\n`, so the line preceding the `.`
 * already ends with `;` and we can splice a new `;`-terminated predicate
 * before it without rewriting separators.
 */
function insertBeforeFinalDot(ttl: string, newLine: string): string {
  const trailing = ttl.match(/(\s*\.\s*)$/);
  if (!trailing) {
    return ttl + (ttl.endsWith('\n') ? '' : '\n') + newLine + '\n    .\n';
  }
  const dotIdx = trailing.index ?? ttl.length;
  const lineStart = ttl.lastIndexOf('\n', dotIdx - 1);
  if (lineStart < 0) {
    return ttl.slice(0, dotIdx).replace(/\s+$/, ' ;') + '\n' + newLine + '\n' + ttl.slice(dotIdx);
  }
  return ttl.slice(0, lineStart) + '\n' + newLine + ttl.slice(lineStart);
}

export function ttlString(s: string): string {
  const escaped = s
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .replace(/\t/g, '\\t');
  return `"${escaped}"`;
}

/** One predicate to upsert. `value` is the raw TTL object (already a quoted
 *  literal / typed literal), or `null` to delete the predicate. */
export interface SourceMetaUpdate {
  predicate: string;
  value: string | null;
}

/**
 * Upsert several single-valued predicates into a source's meta.ttl in one pass,
 * writing + reindexing only if something actually changed. Returns the list of
 * predicates whose value changed (so callers can report what landed).
 */
export async function setSourceProperties(
  rootPath: string,
  sourceId: string,
  updates: SourceMetaUpdate[],
): Promise<string[]> {
  const metaPath = sourceMetaPath(rootPath, sourceId);
  let ttl = await readMeta(metaPath);
  const changed: string[] = [];
  for (const u of updates) {
    const next = upsertSingleValuedPredicate(ttl, u.predicate, u.value);
    if (next !== ttl) {
      changed.push(u.predicate);
      ttl = next;
    }
  }
  if (changed.length > 0) {
    await fs.writeFile(metaPath, ttl, 'utf-8');
    await reindexSource(rootPath, sourceId);
  }
  return changed;
}

/**
 * Rename a source by upserting its `dc:title` (#765). A source's display name
 * is its `dc:title`; `displaySourceTitle` falls back to URI/DOI/"Untitled" only
 * when it's absent, so renaming is just a single-predicate upsert + reindex —
 * the same direct-write path as read-status (a user action, not an LLM
 * proposal, so it does not go through the approval engine). Empty/whitespace
 * titles are rejected so a rename can't blank the name into the fallback.
 */
export async function setSourceTitle(
  rootPath: string,
  sourceId: string,
  title: string,
): Promise<void> {
  const trimmed = title.trim();
  if (!trimmed) throw new Error('Source title cannot be empty.');
  await setSourceProperties(rootPath, sourceId, [
    { predicate: 'dc:title', value: ttlString(trimmed) },
  ]);
}
