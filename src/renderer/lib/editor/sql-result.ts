/**
 * Normalize a DuckDB result — rows keyed by column with native JS types —
 * into the `Record<string, string>[]` shape the existing results table
 * expects. BigInts stringify, nulls become empty strings, everything else
 * goes through String(). Matches the SPARQL path's contract.
 */
export function normalizeSqlRows(
  columns: string[],
  rows: Record<string, unknown>[],
): Record<string, string>[] {
  return rows.map((row) => {
    const out: Record<string, string> = {};
    for (const col of columns) {
      const v = row[col];
      out[col] =
        v == null
          ? ''
          : typeof v === 'string'
            ? v
            : typeof v === 'bigint'
              ? v.toString()
              : v instanceof Date
                ? v.toISOString()
                : typeof v === 'object'
                  ? JSON.stringify(v)
                  : typeof v === 'number' || typeof v === 'boolean'
                    ? String(v)
                    : '';
    }
    return out;
  });
}

/**
 * Derive a column list from the union of keys across all result rows, in
 * first-seen order. Fallback for the SPARQL path when the engine's projection
 * metadata is unavailable — strictly better than reading only the first row's
 * keys (which misses a variable bound in some rows but not the first). Cannot
 * recover a variable that is unbound in every row; that's what the projection
 * metadata is for.
 */
export function unionColumns(rows: Record<string, unknown>[]): string[] {
  const cols: string[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    for (const k of Object.keys(row)) {
      if (!seen.has(k)) { seen.add(k); cols.push(k); }
    }
  }
  return cols;
}
