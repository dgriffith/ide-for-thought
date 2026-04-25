/**
 * Delete a Source and its excerpts.
 *
 * Cascades by design: a Source's excerpts have no meaning without the
 * Source, so we remove them first. Wiki-links / cite-links pointing at
 * the deleted source become dead links — same UX story as deleting a
 * note, and users have git for recovery.
 *
 * Order of operations matters for the graph + disk: we remove graph
 * entries first (so the watcher doesn't re-add them when it sees the
 * file disappear), then delete the files.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';

export interface DeleteSourceResult {
  sourceId: string;
  /** Number of excerpts removed alongside the source. */
  excerptsRemoved: number;
}

export async function deleteSource(
  rootPath: string,
  sourceId: string,
): Promise<DeleteSourceResult> {
  const sourceDir = path.join(rootPath, '.minerva', 'sources', sourceId);
  const ctx = projectContext(rootPath);

  // Snapshot excerpt ids before we wipe the graph — once the graph
  // entries are gone, we can't list them anymore.
  const excerptIds = graph.excerptIdsForSource(ctx, sourceId);

  for (const id of excerptIds) {
    graph.removeExcerpt(ctx, id);
    const excerptFile = path.join(rootPath, '.minerva', 'excerpts', `${id}.ttl`);
    try { await fs.unlink(excerptFile); } catch { /* already gone */ }
  }

  graph.removeSource(ctx, sourceId);
  try {
    await fs.rm(sourceDir, { recursive: true, force: true });
  } catch { /* already gone */ }

  return { sourceId, excerptsRemoved: excerptIds.length };
}
