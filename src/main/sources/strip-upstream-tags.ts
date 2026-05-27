/**
 * "Strip upstream tags" command (#473). Removes every
 * `minerva:upstreamTag "..."` line from a source's meta.ttl, then
 * re-indexes so the hasTag edges those tags produced go away too.
 *
 * Hand-edits to the user's own #tags in body.md are untouched —
 * only the API-derived tag literals are dropped.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';

export interface StripUpstreamResult {
  /** Number of upstreamTag literals removed from meta.ttl. */
  removed: number;
}

export async function stripUpstreamTags(rootPath: string, sourceId: string): Promise<StripUpstreamResult> {
  const metaPath = path.join(rootPath, '.minerva', 'sources', sourceId, 'meta.ttl');
  let ttl: string;
  try {
    ttl = await fs.readFile(metaPath, 'utf-8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { removed: 0 };
    throw err;
  }
  const { ttl: next, removed } = removeUpstreamTagLines(ttl);
  if (removed === 0) return { removed: 0 };
  await fs.writeFile(metaPath, next, 'utf-8');

  // Re-index to drop the corresponding hasTag edges from the graph.
  // The indexer always rebuilds source-scoped triples from the
  // current meta.ttl, so the rebuilt edges no longer include the
  // upstream ones.
  const ctx = projectContext(rootPath);
  let body: string | undefined;
  try { body = await fs.readFile(path.join(rootPath, '.minerva', 'sources', sourceId, 'body.md'), 'utf-8'); } catch { /* ok */ }
  graph.indexSource(ctx, sourceId, next, body);

  return { removed };
}

/**
 * Remove every line whose first non-whitespace token is
 * `minerva:upstreamTag`. Returns the new ttl + a count of dropped
 * lines so callers can short-circuit when nothing changed.
 *
 * Exposed for tests.
 */
export function removeUpstreamTagLines(ttl: string): { ttl: string; removed: number } {
  let removed = 0;
  const next = ttl.replace(/^[ \t]*minerva:upstreamTag\s+[^\n]*\n?/gm, () => {
    removed++;
    return '';
  });
  return { ttl: next, removed };
}
