/**
 * A view whose notes come from a query (#2944, epic #2936): the shape main
 * hands back for `views:queryRows`, and the pure rules that make one from a
 * query's raw result — which column names the notes, and what type each
 * column is. Main runs the query (`main/views/query-rows.ts`); the view
 * draws the schema and rows like a type's (#2943).
 *
 * **Column types are inferred from the values**, as a `PropertyDef.type`,
 * first rule that holds over every non-empty value (`inferColumnType`):
 * - every value names a note → `link-to-type`;
 * - every value is `true`/`false` → `boolean`;
 * - every value is `"<lat>,<lng>"` → `geo`;
 * - every value is a date (`parseDateValue`), at least one finer than a year
 *   (a column of bare years reads as numbers) → `datetime` if any has a time,
 *   else `date`;
 * - every value is a number → `number`;
 * - at most `ENUM_MAX_OPTIONS` distinct values over at least 2 rows, at least
 *   one repeated → `enum`, its options in first-seen order;
 * - otherwise `text`. A column with no values at all is `text`.
 *
 * `columns: "due:date, status:enum"` overrides any of them; an unknown type
 * in it is ignored, never an error — the text was written by a note's author.
 */
import { PROPERTY_TYPES, type PropertyDef, type PropertyType } from '../objects/type-def';
import { isClockPrecision, parseDateValue } from '../objects/date-precision';
import { parseLatLng } from '../objects/geo-value';

export type QueryLanguage = 'sparql' | 'sql';

/** How many rows a query view draws; past it, the result says `truncated`. */
export const QUERY_VIEW_ROW_LIMIT = 5000;
/** The most distinct values a column may have and still read as an `enum`. */
export const ENUM_MAX_OPTIONS = 12;

export interface QueryRowsOptions {
  /** The column whose values name the rows' notes; absent: the first that does. */
  note?: string | undefined;
  /** Per-column type overrides: `"due:date, status:enum"`. */
  columns?: string | undefined;
}

/** One row of a query view: a note's, or (no `path`) one that names none. */
export interface QueryViewRow {
  path: string | null;
  title: string;
  /** Every schema column's value, as text; null where the row has none. */
  values: Record<string, string | null>;
  /** The note's tags (#2768); absent for a row with no note. */
  tags?: string[];
}

export interface QueryViewSchema {
  /** The columns other than the note column and a projected `title`, typed. */
  columns: PropertyDef[];
  /** The column that names each row's note, or null when none does. */
  noteColumn: string | null;
}

/**
 * The query's rows, or why it couldn't run. A user's malformed query is an
 * expected outcome the view renders inline (IPC error handling, rule 3), so
 * the call itself does not reject for it.
 */
export type QueryRowsResult =
  | { ok: true; schema: QueryViewSchema; rows: QueryViewRow[]; truncated: boolean }
  | { ok: false; error: string };

/** `"due:date, status:enum"` → `{ due: 'date', status: 'enum' }`, unknown types dropped. */
export function parseColumnOverrides(text: string | undefined): Record<string, PropertyType> {
  const out: Record<string, PropertyType> = {};
  for (const part of (text ?? '').split(',')) {
    const [name, type] = part.split(':').map((s) => s.trim());
    if (name && type && (PROPERTY_TYPES as readonly string[]).includes(type)) out[name] = type as PropertyType;
  }
  return out;
}

const NUMBER_RE = /^[+-]?(\d+(\.\d*)?|\.\d+)([eE][+-]?\d+)?$/;

/**
 * A column's type and, for an enum, its options, from its values (see the
 * header). `isNote(v)` says whether a value names a note.
 */
export function inferColumnType(values: readonly (string | null)[], isNote: (v: string) => boolean): Pick<PropertyDef, 'type' | 'options'> {
  const vals = values.filter((v): v is string => v !== null && v.trim() !== '').map((v) => v.trim());
  if (vals.length === 0) return { type: 'text' };
  if (vals.every(isNote)) return { type: 'link-to-type' };
  if (vals.every((v) => v === 'true' || v === 'false')) return { type: 'boolean' };
  if (vals.every((v) => parseLatLng(v) !== null && v.includes(','))) return { type: 'geo' };
  const dates = vals.map((v) => parseDateValue(v));
  if (dates.every((d) => d !== null) && dates.some((d) => d.precision !== 'year')) {
    return { type: dates.some((d) => isClockPrecision(d.precision)) ? 'datetime' : 'date' };
  }
  if (vals.every((v) => NUMBER_RE.test(v))) return { type: 'number' };
  const distinct = [...new Set(vals)];
  if (vals.length >= 2 && distinct.length <= ENUM_MAX_OPTIONS && distinct.length < vals.length) return { type: 'enum', options: distinct };
  return { type: 'text' };
}

/**
 * The note column: `preferred` when the result has it, else the first column
 * with at least one value where every non-empty value names a note; null when
 * none does.
 */
export function pickNoteColumn(
  columns: readonly string[],
  rows: readonly Record<string, string | null>[],
  isNote: (v: string) => boolean,
  preferred?: string,
): string | null {
  if (preferred && columns.includes(preferred)) return preferred;
  for (const c of columns) {
    const vals = rows.map((r) => r[c]).filter((v): v is string => v !== null && v !== undefined && v !== '');
    if (vals.length > 0 && vals.every(isNote)) return c;
  }
  return null;
}
