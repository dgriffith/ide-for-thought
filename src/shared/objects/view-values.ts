/**
 * How a type view (#1070) sorts and exports one property's values — the
 * per-type rules `TypeView` applies to every layout, kept pure so they test
 * without a DOM. How a value is SHOWN is `property-display.ts`.
 *
 * Values are the instances' lexical strings, as the graph returns them.
 */
import type { PropertyDef, PropertyType, TypeInstanceRow } from './type-def';
import { compareDateValues } from './date-values';
import { displayPropertyValue } from './property-display';
import { serializeCsv } from '../csv-parse';

/**
 * Sort order for two non-empty values of one property: numbers numerically,
 * dates by span (#2613: `-0043` before `0044`, offsets by instant), the rest
 * as text with numeric runs compared as numbers.
 */
export function comparePropertyValues(type: PropertyType | undefined, a: string, b: string): number {
  if (type === 'number') return Number(a) - Number(b);
  if (type === 'date' || type === 'datetime') return compareDateValues(a, b);
  return a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });
}

/**
 * A view as CSV: a Title column, then `columns`, one row per instance in the
 * order given. Values are machine-readable, not the display text: a date or
 * `datetime` is its ISO value, not the locale string, so a spreadsheet can
 * read it back. A link is its target's name; an empty value an empty cell.
 */
export function viewToCsv(columns: readonly PropertyDef[], rows: readonly TypeInstanceRow[]): string {
  const headers = ['Title', ...columns.map((c) => c.label ?? c.name)];
  const body = rows.map((inst) => [
    inst.title,
    ...columns.map((c) => {
      const v = inst.values[c.name];
      if (v === null || v === undefined) return '';
      // A link reads as its note's name, as on screen; plain text as written.
      return c.type === 'link-to-type' && v !== '' ? displayPropertyValue(c, v) : v;
    }),
  ]);
  return serializeCsv(headers, body);
}
