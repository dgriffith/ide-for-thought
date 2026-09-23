/**
 * Coercions for DuckDB values crossing the JS → cell/Python boundary.
 *
 * The node-duckdb client hands 64-bit integer columns (INTEGER, BIGINT, …)
 * back as JS `BigInt`, which `JSON.stringify` refuses outright. Every path that
 * carries a DuckDB row out of `runQuery` has to turn those into something
 * JSON-safe: the RPC path that feeds `minerva.sql()`, the ```sql fence table
 * path, and — since #2228 — the `TABLES_QUERY` IPC boundary the Query panel,
 * query directives and chart data bindings all read through.
 */

const MAX_SAFE_BIGINT = BigInt(Number.MAX_SAFE_INTEGER);
const MIN_SAFE_BIGINT = BigInt(Number.MIN_SAFE_INTEGER);

/**
 * Turn a DuckDB `BigInt` into a JSON-safe scalar, keeping it *numeric*
 * whenever it fits exactly in a JS double. Only values outside the
 * safe-integer range fall back to a decimal string, where `Number()` would
 * silently drop precision.
 *
 * Preserving in-range integers as real numbers is what lets `minerva.sql(...)`
 * hand pandas an `int64` column instead of a string one. Stringifying every
 * integer was a latent type-loss that pandas ≤2 papered over by coercing
 * numeric-looking object columns; pandas 3.0's strict `str` dtype does not —
 * it rejects `.mean()`/`.sum()`/`groupby` aggregation on the column outright.
 */
export function coerceDuckBigInt(v: bigint): number | string {
  return v >= MIN_SAFE_BIGINT && v <= MAX_SAFE_BIGINT ? Number(v) : v.toString();
}

/**
 * Apply {@link coerceDuckBigInt} across a `runQuery` result set (#2228).
 *
 * `runQuery` itself deliberately still hands back whatever the DuckDB client
 * produced; this runs at the **IPC boundary** (`TABLES_QUERY` in
 * `ipc/register-graph.ts`), which was the one DuckDB→JS exit in the app that
 * did no coercion at all. The SQL-fence executor (`executors/sql.ts`), the
 * Python RPC bridge (`rpc-server.ts:serializeForJson`) and the `query_sql` LLM
 * tool each coerce on their own way out; the renderer had grown two more
 * private copies of the same fix (`renderer/lib/editor/sql-result.ts` and
 * `shared/vega/data-binding.ts:normalizeRows`, whose comment says outright that
 * "vega-embed throws trying to serialize a BigInt"). Five independent
 * rediscoveries of one leak is the argument for closing it at the boundary
 * rather than waiting for the sixth consumer — the one that doesn't know.
 *
 * It is not hypothetical arithmetic: DuckDB's CSV sniffer types an integer
 * column as BIGINT, so the *ordinary* `SELECT * FROM <csv table>` the Tables
 * panel opens comes back with a `bigint` in every integer cell, and
 * `JSON.stringify` on that result throws `TypeError: Do not know how to
 * serialize a BigInt` (verified against a real registered CSV — see
 * `tests/main/sources/tables.test.ts`). It survives structured clone, so it
 * reaches the renderer intact and only explodes at whichever consumer reaches
 * for JSON first.
 *
 * Why not inside `runQuery`: every main-process caller listed above already
 * walks the whole result set to normalize Dates and nested types, so coercing
 * there would add a second full O(rows × cols) pass to the Python and cell
 * paths — the exact materialization cost the rest of #2228 is cutting — and it
 * would silently change the shape asserted by the existing `runQuery` tests.
 *
 * Non-bigint values (including Dates, which structured-clone fine and which
 * each consumer renders its own way) pass through untouched, and a row with no
 * bigint in it is returned by reference rather than rebuilt.
 */
export function coerceDuckRowsForIpc(
  rows: Record<string, unknown>[],
): Record<string, unknown>[] {
  return rows.map((row) => {
    let changed = false;
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'bigint') { out[k] = coerceDuckBigInt(v); changed = true; }
      else out[k] = v;
    }
    return changed ? out : row;
  });
}
