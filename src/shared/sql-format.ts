import { format } from 'sql-formatter';

/**
 * Pretty-print SQL using the DuckDB dialect — standard keyword case
 * (UPPER), two-space indent. Paired with the Query Panel's Format
 * button (#260) and usable anywhere else SQL needs canonicalising.
 *
 * Returns the original text unchanged on any parser error so a
 * half-typed query can't be mangled mid-edit.
 */
export function formatSql(text: string): string {
  try {
    return format(text, { language: 'duckdb', keywordCase: 'upper' });
  } catch {
    return text;
  }
}
