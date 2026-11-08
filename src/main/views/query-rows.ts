/**
 * A query view's rows (#2944, epic #2936): run a SPARQL or SQL query the way
 * a view may, and turn its result into a typed schema and rows that name
 * notes (`shared/views/query-view.ts` has the shape and the inference).
 *
 * - **It only reads, and SQL is guarded.** SPARQL goes through `queryGraph`,
 *   which refuses Update. SQL goes through `tables.runNoteQuery` —
 *   `guardSql(…, 'note')`, the registered relations only — and never
 *   `runQuery`: a view runs with nobody pressing Run, in a tab, an embed or
 *   an export, and a note's author isn't necessarily the user (#2448).
 * - **Capped** at `QUERY_VIEW_ROW_LIMIT` rows, with `truncated` said.
 * - **Notes.** Every value that is a note's IRI, or a note's path, names
 *   that note (`notePathsForValues`). The note column is `opts.note`, else
 *   the first column whose every value names one; a row with that column
 *   empty has no note. Its values in note columns read as the note's path.
 * - **Titles and tags** are the note's, as a type view's rows (`noteTitle`:
 *   `dc:title`, else the file name; `noteTagsFor`) — unless the query
 *   projects a `title` column, which wins. A row with no note is titled by
 *   that column, else by its first column's value.
 * - A query the user wrote wrongly is `{ ok: false, error }`, for the view to
 *   say inline (IPC error handling, rule 3).
 */
import type { ProjectContext } from '../project-context-types';
import { notePathsForValues, noteTagsFor, noteTitle, queryGraph } from '../graph';
import { runNoteQuery } from '../sources/tables';
import {
  QUERY_VIEW_ROW_LIMIT, inferColumnType, parseColumnOverrides, pickNoteColumn,
  type QueryLanguage, type QueryRowsOptions, type QueryRowsResult, type QueryViewRow,
} from '../../shared/views/query-view';
import type { PropertyDef } from '../../shared/objects/type-def';

/**
 * A raw value as text: SQL hands back numbers, BigInts, booleans and dates;
 * SPARQL strings. DuckDB's DATE and TIMESTAMP both arrive as a JS `Date`, the
 * type unsaid, so one at exactly midnight UTC is written as its day — a DATE
 * column reads as dates, not as midnights.
 */
function text(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) {
    if (!Number.isFinite(v.getTime())) return null;
    const iso = v.toISOString();
    return v.getTime() % 86_400_000 === 0 ? iso.slice(0, iso.indexOf('T')) : iso;
  }
  let s: string;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'bigint' || typeof v === 'boolean') s = String(v);
  // A DuckDB list or struct: its JSON, BigInts as numbers (they throw in JSON.stringify).
  else if (typeof v === 'object') s = JSON.stringify(v, (_k, x: unknown) => (typeof x === 'bigint' ? Number(x) : x));
  else return null;
  return s === '' ? null : s;
}

/** Run `query` and read its result as a view's schema and rows (see the header). */
export async function queryViewRows(
  ctx: ProjectContext,
  query: string,
  language: QueryLanguage,
  opts: QueryRowsOptions = {},
): Promise<QueryRowsResult> {
  let columns: string[];
  let raw: Record<string, unknown>[];
  if (language === 'sparql') {
    const r = await queryGraph(ctx, query);
    if (!r.ok) return { ok: false, error: r.error };
    columns = r.columns;
    raw = r.results as Record<string, unknown>[];
  } else {
    const r = await runNoteQuery(ctx, query);
    if (!r.ok) return { ok: false, error: r.error };
    columns = r.columns;
    raw = r.rows;
  }
  const truncated = raw.length > QUERY_VIEW_ROW_LIMIT;
  const cells = raw.slice(0, QUERY_VIEW_ROW_LIMIT).map((row) => {
    const out: Record<string, string | null> = {};
    for (const c of columns) out[c] = text(row?.[c]);
    return out;
  });

  const notes = notePathsForValues(ctx, cells.flatMap((r) => Object.values(r).filter((v): v is string => v !== null)));
  const isNote = (v: string) => notes.has(v);
  const noteColumn = pickNoteColumn(columns, cells, isNote, opts.note);
  const titleColumn = columns.find((c) => c === 'title' && c !== noteColumn) ?? null;
  const overrides = parseColumnOverrides(opts.columns);

  const shown = columns.filter((c) => c !== noteColumn && c !== titleColumn);
  const schema: PropertyDef[] = shown.map((name) => {
    const forced = overrides[name];
    const inferred = inferColumnType(cells.map((r) => r[name] ?? null), isNote);
    return forced ? { name, type: forced, ...(forced === 'enum' && inferred.options ? { options: inferred.options } : {}) } : { name, ...inferred };
  });
  const linkColumns = new Set(schema.filter((p) => p.type === 'link-to-type').map((p) => p.name));

  const paths = cells.map((r) => (noteColumn && r[noteColumn] ? notes.get(r[noteColumn]) ?? null : null));
  const tags = noteTagsFor(ctx, paths.filter((p): p is string => p !== null));
  const rows: QueryViewRow[] = cells.map((r, i) => {
    const path = paths[i]!;
    const values: Record<string, string | null> = {};
    for (const c of shown) {
      const v = r[c] ?? null;
      values[c] = v !== null && linkColumns.has(c) ? notes.get(v) ?? v : v;
    }
    const projected = titleColumn ? r[titleColumn] ?? null : null;
    const title = projected ?? (path ? noteTitle(ctx, path) : r[columns[0] ?? ''] ?? '');
    const t = path ? tags.get(path) : undefined;
    return { path, title, values, ...(t ? { tags: t } : {}) };
  });
  return { ok: true, schema: { columns: schema, noteColumn }, rows, truncated };
}
