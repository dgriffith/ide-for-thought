/**
 * A query view's rows as a view draws them (#2946, epic #2936): from #2944's
 * `QueryViewRow`s to the `TypeInstanceRow`s every layout reads.
 *
 * - **A table keeps every row** (`toViewRows`): a note in three solutions is
 *   three rows. The second and later get a `key` of their own, since the
 *   layouts key by it.
 * - **A row that names no note** draws too, under a synthetic path
 *   (`#row-N`, which no note can have: a note's path has an extension) with
 *   `noNote`, so the view never opens, selects, menus or previews it.
 * - **Card layouts are one card per note** (`mergeRowsByNote`; decision on
 *   #2946): a gallery, board, map, timeline or calendar can't show a note
 *   twice, so its rows merge, each column joining its distinct values with
 *   ", " — for this source, the end of #2775's "only the first value".
 */
import type { TypeInstanceRow } from '../objects/type-def';
import type { QueryViewRow } from './query-view';

/** The synthetic path's prefix for a row with no note. */
export const NO_NOTE_PREFIX = '#row-';

/** Every row, keyed uniquely (see the header). */
export function toViewRows(rows: readonly QueryViewRow[]): TypeInstanceRow[] {
  const seen = new Map<string, number>();
  return rows.map((r, i) => {
    const base = { title: r.title, values: { ...r.values }, cover: null, ...(r.tags ? { tags: r.tags } : {}) };
    if (r.path === null) return { ...base, path: `${NO_NOTE_PREFIX}${i}`, noNote: true as const };
    const n = (seen.get(r.path) ?? 0) + 1;
    seen.set(r.path, n);
    return n === 1 ? { ...base, path: r.path } : { ...base, path: r.path, key: `${r.path}#${n}` };
  });
}

/** One row per note, its columns' distinct values joined (see the header). Rows with no note stay as they are. */
export function mergeRowsByNote(rows: readonly TypeInstanceRow[]): TypeInstanceRow[] {
  const byPath = new Map<string, { row: TypeInstanceRow; values: Map<string, string[]>; tags: Set<string> }>();
  const out: TypeInstanceRow[] = [];
  for (const r of rows) {
    if (r.noNote) { out.push(r); continue; }
    let m = byPath.get(r.path);
    if (!m) {
      m = { row: { ...r, values: {} }, values: new Map(), tags: new Set(r.tags ?? []) };
      delete m.row.key;
      byPath.set(r.path, m);
      out.push(m.row);
    }
    for (const [k, v] of Object.entries(r.values)) {
      const list = m.values.get(k) ?? [];
      if (v !== null && v !== '' && !list.includes(v)) list.push(v);
      m.values.set(k, list);
    }
    for (const t of r.tags ?? []) m.tags.add(t);
  }
  for (const m of byPath.values()) {
    for (const [k, list] of m.values) m.row.values[k] = list.length === 0 ? null : list.join(', ');
    if (m.tags.size > 0) m.row.tags = [...m.tags];
  }
  return out;
}
