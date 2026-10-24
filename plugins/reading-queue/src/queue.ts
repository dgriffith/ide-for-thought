/**
 * The Reading Queue's model (#2640): its query's rows, as the items the panel
 * lists. Pure, so it is tested without a frame.
 */
import type { PluginQueryResults } from '/@minerva/plugin-api.js';

export type QueueKind = 'book' | 'article';

export interface QueueItem {
  path: string;
  title: string;
  kind: QueueKind;
  /** `reading`, or not started yet (`to-read` for a book, `unread` for an article). */
  reading: boolean;
  author: string | null;
}

/**
 * The query's rows as items, in its order: one per note, the first row for a
 * note winning (two authors give two rows). A row whose `?note` isn't a note
 * Minerva gave the view is left out — the panel couldn't open it.
 */
export function queueItems(results: PluginQueryResults): QueueItem[] {
  const seen = new Set<string>();
  const out: QueueItem[] = [];
  for (const row of results.rows) {
    const path = row.note !== undefined ? results.notes[row.note] : undefined;
    if (path === undefined || seen.has(path)) continue;
    const kind = row.kind === 'article' ? 'article' : row.kind === 'book' ? 'book' : null;
    if (kind === null) continue;
    seen.add(path);
    out.push({ path, title: row.title || path, kind, reading: row.status === 'reading', author: row.author || null });
  }
  return out;
}

/** The property that marks one read: a book's `status`, an article's `read`. */
export function markReadPatch(kind: QueueKind): Record<string, string> {
  return kind === 'book' ? { status: 'read' } : { read: 'read' };
}
