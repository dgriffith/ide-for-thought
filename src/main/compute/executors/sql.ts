/**
 * SQL fence executor (#240) — second concrete language on top of the
 * compute shell (#238), sibling to #239's SPARQL path. A ```sql fence
 * runs through the same DuckDB connection the Query Panel uses, so
 * `SELECT * FROM foo` in a fence and in a query tab return identical
 * rows.
 */

import { runQuery } from '../../sources/tables';
import { projectContext } from '../../project-context-types';
import type { ExecutorFn } from '../registry';

/**
 * Run a SQL statement against the project's DuckDB. On success, returns
 * a `type:"table"` cell output with rows normalised into the cell-output
 * primitive set (`string | number | boolean | null`) so the preview
 * renderer can draw them without running a JSON type check per cell.
 * BigInts stringify (DuckDB returns INTEGER columns as BigInt); Dates
 * become ISO strings; everything else passes through as-is.
 */
export const executeSql: ExecutorFn = async (code, ctx) => {
  const response = await runQuery(projectContext(ctx.rootPath), code);
  if (!response.ok) return { ok: false, error: response.error };
  return {
    ok: true,
    output: {
      type: 'table',
      columns: response.columns,
      rows: response.rows.map((row) => response.columns.map((c) => normalizeCell(row[c]))),
    },
  };
};

function normalizeCell(v: unknown): string | number | boolean | null {
  if (v == null) return null;
  if (typeof v === 'bigint') return v.toString();
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return v;
  // Arrays / structs / maps — DuckDB nested types don't have a canonical
  // primitive rendering; stringify as JSON so the table stays legible
  // rather than showing `[object Object]`.
  return JSON.stringify(v);
}
