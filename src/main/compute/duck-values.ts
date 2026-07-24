/**
 * Coercions for DuckDB values crossing the JS → cell/Python boundary.
 *
 * The node-duckdb client hands 64-bit integer columns (INTEGER, BIGINT, …)
 * back as JS `BigInt`, which `JSON.stringify` refuses outright. Both the RPC
 * path that feeds `minerva.sql()` and the ```sql fence table path have to turn
 * those into something JSON-safe.
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
