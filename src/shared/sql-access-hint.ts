/**
 * What to tell a user whose SQL hit the file-access lockdown (#2437).
 *
 * The tables DuckDB may only read files inside the thoughtbase, and its
 * refusal — `Permission Error: Cannot access file "…" - file system
 * operations are disabled by configuration` — says what happened but not
 * what to do. The error paths that show SQL errors to the user (the Query
 * panel, query blocks, cell outputs) append this hint; the LLM's `query_sql`
 * deliberately doesn't get it.
 *
 * Matching the message, not the call site, is what lets a Python cell's
 * `minerva.sql()` traceback get the hint too — it carries the same text.
 */

const LOCKDOWN_REFUSAL = /Permission Error: Cannot access (?:file|directory) .*disabled by configuration/;

export const SQL_OUTSIDE_ROOT_HINT =
  'SQL can only read files inside this thoughtbase. Copy the file into the ' +
  'thoughtbase, or read it from a Python cell.';

/** `error` with the hint appended when it is the lockdown's refusal; otherwise `error` unchanged. */
export function withSqlAccessHint(error: string): string {
  if (!LOCKDOWN_REFUSAL.test(error) || error.includes(SQL_OUTSIDE_ROOT_HINT)) return error;
  return `${error}\n\n${SQL_OUTSIDE_ROOT_HINT}`;
}
