/**
 * Vega data binding — resolution layer (#832 pt 1, #880).
 *
 * A Vega-Lite chart can name a Minerva data source instead of inlining values:
 *
 *   "data": { "sparql": "SELECT …" }   // the knowledge graph
 *   "data": { "sql":    "SELECT …" }   // a DuckDB query over registered tables
 *   "data": { "table":  "sales_data" } // sugar for SELECT * FROM sales_data
 *   "data": { "cell":   "a1b2c3d4" }   // a compute cell's output block
 *
 * This module is the process-agnostic core: it detects the form, and turns
 * source rows into the inline `data.values` array Vega expects — coercing the
 * stringly-typed rows SPARQL returns so quantitative/temporal encodings work.
 * The actual query execution is injected by the caller (an `SourceExecutor`),
 * so the renderer (`window.api.*`) and the export pipeline (main-process calls)
 * reuse the same resolution without re-implementing execution.
 *
 * Resolving to inline values keeps the #829 security posture intact: vega-embed
 * still only ever sees `data.values`, never a `url`.
 */

export type VegaRow = Record<string, unknown>;
export type VegaRows = VegaRow[];

export type DataSourceRef =
  | { kind: 'sparql'; query: string }
  | { kind: 'sql'; query: string }
  | { kind: 'table'; name: string }
  | { kind: 'cell'; id: string };

/** An executor resolves one reference to rows. Callers provide the handlers
 *  they support; an unhandled kind surfaces as a clear error (not a silent
 *  empty chart). */
export type SourceExecutor = (ref: DataSourceRef) => Promise<VegaRows>;

/**
 * Detect a Minerva data-binding form on a parsed spec. Returns null for plain
 * inline `data.values`, a (blocked) `data.url`, or a full-Vega `data` array —
 * all of which pass through untouched. Only the Vega-Lite object form binds.
 */
export function detectDataSource(spec: unknown): DataSourceRef | null {
  if (!spec || typeof spec !== 'object') return null;
  const data = (spec as { data?: unknown }).data;
  if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
  const d = data as Record<string, unknown>;
  if (typeof d.sparql === 'string') return { kind: 'sparql', query: d.sparql };
  if (typeof d.sql === 'string') return { kind: 'sql', query: d.sql };
  if (typeof d.table === 'string') return { kind: 'table', name: d.table };
  if (typeof d.cell === 'string') return { kind: 'cell', id: d.cell };
  return null;
}

/**
 * Zip a column-ordered table (the compute-cell / SQL-executor output shape,
 * `{ columns, rows: primitive[][] }`) into row objects keyed by column.
 */
export function rowsFromTable(columns: string[], rows: unknown[][]): VegaRows {
  return rows.map((row) => {
    const obj: VegaRow = {};
    columns.forEach((col, i) => { obj[col] = row[i] ?? null; });
    return obj;
  });
}

/**
 * Normalize cell values that Vega/JSON can't handle. DuckDB returns BigInt for
 * integer columns and Date objects for date/timestamp columns; vega-embed
 * throws trying to serialize a BigInt and mishandles Dates. Convert BigInt →
 * number (fine for chart ranges) and Date → ISO string (Vega parses `temporal`
 * from it). Everything else passes through untouched.
 */
export function normalizeRows(rows: VegaRows): VegaRows {
  return rows.map((row) => {
    let changed = false;
    const out: VegaRow = {};
    for (const [k, v] of Object.entries(row)) {
      if (typeof v === 'bigint') { out[k] = Number(v); changed = true; }
      else if (v instanceof Date) { out[k] = v.toISOString(); changed = true; }
      else out[k] = v;
    }
    return changed ? out : row;
  });
}

/**
 * Best-effort numeric coercion. SPARQL returns every value as a string, which
 * breaks Vega's `quantitative` encodings ("10" sorts lexically, won't sum). For
 * each column whose every non-empty value parses as a finite number, convert
 * those values to numbers. Columns with any non-numeric value (dates, labels)
 * are left as strings — Vega infers temporal/nominal from them fine.
 */
export function coerceRows(rows: VegaRows): VegaRows {
  if (rows.length === 0) return rows;
  const keys = new Set<string>();
  for (const row of rows) for (const k of Object.keys(row)) keys.add(k);

  const numericCols = new Set<string>();
  for (const key of keys) {
    let sawValue = false;
    let allNumeric = true;
    for (const row of rows) {
      const v = row[key];
      if (v === undefined || v === null || v === '') continue;
      sawValue = true;
      if (typeof v === 'number') continue;
      if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) continue;
      allNumeric = false;
      break;
    }
    if (sawValue && allNumeric) numericCols.add(key);
  }
  if (numericCols.size === 0) return rows;

  return rows.map((row) => {
    const out: VegaRow = { ...row };
    for (const key of numericCols) {
      const v = out[key];
      if (typeof v === 'string' && v.trim() !== '') out[key] = Number(v);
    }
    return out;
  });
}

/**
 * Build the SQL for a `data.table` reference. The table name is a DuckDB
 * identifier, double-quoted with embedded quotes escaped so a crafted name
 * can't break out of the identifier (`evil"; DROP …`).
 */
export function tableQuerySql(name: string): string {
  return `SELECT * FROM "${name.replace(/"/g, '""')}"`;
}

/**
 * Resolve a detected source to inline values and return a NEW spec with
 * `data: { values }`. Throws with a clear message when the executor can't
 * handle the kind or the query fails — callers render that inline.
 */
export async function resolveVegaData(
  spec: Record<string, unknown>,
  ref: DataSourceRef,
  exec: SourceExecutor,
): Promise<Record<string, unknown>> {
  const rows = await exec(ref);
  return { ...spec, data: { values: coerceRows(normalizeRows(rows)) } };
}
