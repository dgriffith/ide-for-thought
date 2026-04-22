/**
 * SPARQL fence executor (#239) — first concrete language on top of the
 * compute shell (#238). Dispatches through the same `queryGraph` path
 * the Query Panel already uses, so a fence in a note and a query tab
 * with identical SPARQL produce identical rows.
 */

import { queryGraph } from '../../graph';
import type { ExecutorFn } from '../registry';

/**
 * Run a SPARQL SELECT against the project's graph. Returns a
 * `type: "table"` output on success, or a structured error on syntax /
 * runtime failure. Bindings come back as `Record<variable, value>`
 * objects from the graph layer — we flatten them into row-major order
 * using the first binding's keys as the column list.
 */
export const executeSparql: ExecutorFn = async (code) => {
  const response = await queryGraph(code);
  // `queryGraph` returns `{ results: [], error }` on parse / runtime
  // failure — surface that as a cell-level error rather than a thrown
  // exception, so the shell writes a readable output block.
  const err = (response as { error?: string }).error;
  if (err) return { ok: false, error: err };

  const rows = response.results as Array<Record<string, string>>;
  if (rows.length === 0) {
    return { ok: true, output: { type: 'table', columns: [], rows: [] } };
  }
  // Union the keys across all bindings — some engines produce row-shape
  // variance when OPTIONAL clauses leave variables unbound in some rows.
  // Falling back to the first row's keys would drop those columns.
  const columnSet = new Set<string>();
  for (const r of rows) {
    for (const k of Object.keys(r)) columnSet.add(k);
  }
  const columns = [...columnSet];
  // A solution binding with no variables (ASK-like edge case or a bare
  // `SELECT *` against zero triples) comes through as `[{}]` — an empty
  // columns list with a one-row carrier. Render it as empty.
  if (columns.length === 0) {
    return { ok: true, output: { type: 'table', columns: [], rows: [] } };
  }
  const tableRows = rows.map((r) => columns.map((c) => r[c] ?? ''));
  return { ok: true, output: { type: 'table', columns, rows: tableRows } };
};
