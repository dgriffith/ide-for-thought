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

/**
 * A ```reading-queue block's options (#2641): `limit: N` lines its body may
 * hold, one per line, `key: value`. Anything else is ignored.
 */
export function blockOptions(source: string): { limit: number | null } {
  const m = /^\s*limit\s*:\s*(\d+)\s*$/m.exec(source);
  const limit = m ? Number(m[1]) : null;
  return { limit: limit !== null && limit > 0 ? limit : null };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * The queue as static HTML for an export (#2641): inline styles only (the
 * export keeps no stylesheet of a plugin's), each title a link to its note
 * through `data-note-path`, which the export resolves under its own link
 * policy. Minerva sanitizes it before it lands anywhere.
 */
export function exportHtml(items: readonly QueueItem[]): string {
  if (items.length === 0) return '<p style="color:var(--text-muted)">Nothing to read.</p>';
  const section = (label: string, list: readonly QueueItem[]) => (list.length === 0 ? '' : ''
    + `<div style="margin:0.6em 0 0.2em;font-size:0.75em;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:var(--text-faint)">${label}</div>`
    + '<ul style="list-style:none;margin:0;padding:0">'
    + list.map((i) => `<li style="padding:0.15em 0">${i.kind === 'book' ? '📖' : '📄'} <span data-note-path="${escapeHtml(i.path)}">${escapeHtml(i.title)}</span>`
      + (i.author ? ` <span style="color:var(--text-muted)">— ${escapeHtml(i.author)}</span>` : '') + '</li>').join('')
    + '</ul>');
  return `<div>${section('Reading', items.filter((i) => i.reading))}${section('Up next', items.filter((i) => !i.reading))}</div>`;
}
