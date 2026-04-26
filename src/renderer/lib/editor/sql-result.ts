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
