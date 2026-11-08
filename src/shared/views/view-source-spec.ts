/**
 * Where an `object-view` (or a view tab) gets its notes (#2945, epic #2936):
 * a type, as always, or a query — inline, or a saved query by file name.
 *
 * ```json
 * { "typeId": "task", "layout": "table" }
 * { "query": "SELECT ?note ?due WHERE { … }", "language": "sparql", "layout": "table" }
 * { "queryFile": "overdue.rq", "layout": "timeline" }
 * ```
 *
 * - **Exactly one of `typeId`, `query` or `queryFile`.** Two, or none, is an
 *   error the embed shows in place, never a guess.
 * - **`language`** is `"sparql"` (the default) or `"sql"`; a `queryFile`'s
 *   comes from its extension (`.rq` SPARQL, `.sql` SQL). SQL a view runs on
 *   its own always goes through the note guard (#2448), in main.
 * - **`queryFile`** names a saved query by its file name — the
 *   thoughtbase's own saved queries first (`.minerva/queries/`, which travel
 *   with it), then this machine's and plugins'. A reference, not a copy:
 *   Save as note keeps the name, so editing the query changes every view of
 *   it.
 * - **`note` and `columnTypes`** pass to the query source (#2944): the
 *   column naming each row's note, and type overrides (`"due:date, status:enum"`).
 *   `columnTypes`, not `columns`, because `columns` is already the view's
 *   visible-column list.
 *
 * A query view keys its tab, its navigation history and its state by a
 * synthetic `typeId` (`viewKeyFor`), stable for the same query, so all of
 * that works as for a type.
 */
import type { QueryLanguage } from './query-view';

export type ViewSourceSpec =
  | { kind: 'type'; typeId: string }
  | { kind: 'query'; query: string; language: QueryLanguage; note?: string; columnTypes?: string }
  | { kind: 'queryFile'; queryFile: string; note?: string; columnTypes?: string };

/** A query source's spec (not a type's). */
export type QuerySourceSpec = Exclude<ViewSourceSpec, { kind: 'type' }>;

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v : null);

/** A `queryFile`'s language, from its extension. */
export function queryFileLanguage(name: string): QueryLanguage {
  return /\.sql$/i.test(name) ? 'sql' : 'sparql';
}

/** The source a spec names, or why it names none (see the header). Never throws. */
export function parseViewSource(spec: Record<string, unknown>): ViewSourceSpec | { error: string } {
  const typeId = str(spec.typeId);
  const query = str(spec.query);
  const queryFile = str(spec.queryFile);
  const given = [typeId, query, queryFile].filter((v) => v !== null).length;
  if (given !== 1) return { error: 'Exactly one of "typeId", "query" or "queryFile" is required' };
  if (typeId !== null) return { kind: 'type', typeId };
  const extra: { note?: string; columnTypes?: string } = {};
  const note = str(spec.note);
  const columnTypes = str(spec.columnTypes);
  if (note !== null) extra.note = note;
  if (columnTypes !== null) extra.columnTypes = columnTypes;
  if (query !== null) {
    if (spec.language !== undefined && spec.language !== 'sparql' && spec.language !== 'sql') return { error: '"language" must be "sparql" or "sql"' };
    return { kind: 'query', query, language: spec.language === 'sql' ? 'sql' : 'sparql', ...extra };
  }
  return { kind: 'queryFile', queryFile: queryFile!.trim(), ...extra };
}

/** The spec fields that say where the view's notes come from, as written by Save / Copy as markdown. */
export function sourceFields(src: ViewSourceSpec): Record<string, unknown> {
  if (src.kind === 'type') return { typeId: src.typeId };
  const out: Record<string, unknown> = src.kind === 'query' ? { query: src.query, language: src.language } : { queryFile: src.queryFile };
  if (src.note) out.note = src.note;
  if (src.columnTypes) out.columnTypes = src.columnTypes;
  return out;
}

/** 32-bit FNV-1a, as 8 hex digits: a short stable key for a query's text. */
function fnv1a(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * The key a view is identified by — its tab, its place in Back / Forward, its
 * state: a type's id, or for a query one derived from it (`query:1a2b3c4d`,
 * `query-file:overdue.rq`), the same for the same query.
 */
export function viewKeyFor(src: ViewSourceSpec): string {
  if (src.kind === 'type') return src.typeId;
  const opts = `${src.note ?? ''}|${src.columnTypes ?? ''}`;
  if (src.kind === 'queryFile') return `query-file:${src.queryFile}${opts === '|' ? '' : `:${fnv1a(opts)}`}`;
  return `query:${fnv1a(`${src.language}\n${src.query}\n${opts}`)}`;
}

/** The view's title where there's no type to name it: the query file's name, else "Query view". */
export function queryViewTitle(src: QuerySourceSpec): string {
  return src.kind === 'queryFile' ? src.queryFile.replace(/\.(rq|sql)$/i, '') : 'Query view';
}
