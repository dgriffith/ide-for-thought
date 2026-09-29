/**
 * Relation allowlist for model-authored SQL (#2442).
 *
 * The tables DuckDB is locked to the thoughtbase root (#2437), which closed
 * reads OUTSIDE it. It cannot close reads INSIDE it: `allowed_directories`
 * has no way to exclude `<root>/.minerva/`, where conversation transcripts,
 * `secrets.json`, the proposal store and the rest of Minerva's own state
 * live. Every other LLM tool that takes a path refuses that directory — as
 * spelled, in any case, via `..` or through an in-root symlink — through the
 * shared agent-path guard (`agentPathRefusal` in `src/main/path-containment.ts`,
 * #2453; before that, `read_note` and friends did NOT). `query_sql` names
 * files in SQL rather than in a path argument, and has no approval gate, so
 * without this a planted note could pull the user's conversation history into
 * the model's context.
 *
 * `query_sql` legitimately needs only the relations Minerva registered — CSV
 * views and captioned markdown tables — plus a few pure table functions. It
 * never needs a file function. So instead of a denylist over paths (which
 * string concatenation, globbing and replacement scans all get around), this
 * checks the statement against an ALLOWLIST, over DuckDB's own parse of it:
 *
 *   1. `json_serialize_sql` parses the text with the same parser that will
 *      run it. An error, anything but exactly one statement, or any statement
 *      kind other than SELECT (PRAGMA, SET, COPY, ATTACH, INSTALL, EXPLAIN,
 *      a top-level PIVOT, …) is refused — the serializer handles SELECT only.
 *   2. Every node of the resulting tree is visited, fail-closed: a node kind
 *      this module does not explicitly know is refused.
 *      - A `BASE_TABLE` must be a plain identifier naming a CTE in lexical
 *        scope or a relation that exists in the catalog right now. Anything
 *        else would reach DuckDB's replacement scan, which turns
 *        `FROM '.minerva/secrets.json'` or `FROM "x.csv"` into a file read.
 *      - A `TABLE_FUNCTION` must be unqualified and in
 *        {@link SAFE_TABLE_FUNCTIONS}. Every file-, SQL- or extension-backed
 *        one (`read_*`, `glob`, `query`, `sniff_csv`, `parquet_*`,
 *        `json_execute_serialized_sql`, …) is refused by name.
 *      - A scalar `FUNCTION` must not be in {@link REFUSED_SCALAR_FUNCTIONS}.
 *
 * CTE scoping follows what DuckDB actually binds, verified against 1.5.3 and
 * pinned in `tests/main/sources/llm-sql-guard.test.ts`: a query node's CTEs
 * are visible to its whole body (subqueries, LATERAL, set-operation arms);
 * a non-recursive CTE's own body sees only the siblings defined BEFORE it —
 * `WITH x AS (SELECT * FROM x)` reads the outer `x`, which for a quoted path
 * is the file — and a recursive CTE sees itself only in its recursive arm.
 * Where this module's scope is narrower than DuckDB's, the answer is a
 * refusal, never a file read.
 *
 * Three paths run it, each with its own {@link SqlGuardAudience}:
 *   - `model` — the in-app LLM's `query_sql` tool (#2442).
 *   - `note` — SQL written INSIDE a note that runs without the user running
 *     anything: a vega-lite `data.sql` / `data.table` binding (preview and
 *     HTML export) and a `:::query-*` block with `language: sql` (preview)
 *     (#2448). A note's author is not necessarily the user — a shared
 *     thoughtbase is untrusted input — and opening the note is enough to run it.
 *   - `agent` — the `sql_query` tool `minerva mcp` exposes to an EXTERNAL
 *     agent (Claude Desktop, a coding agent, …) (#2452). That agent reads
 *     thoughtbase text through the other MCP tools, so a planted note can
 *     steer it exactly as it could the in-app model — and it often holds
 *     web or shell tools that could carry what it read off the machine.
 * The walker is the same for all three; only the refusal wording differs.
 *
 * What the user runs deliberately keeps the full locked connection: the Query
 * panel, ```sql cells (behind the compute trust gate), Python's
 * `minerva.sql()` and the user-typed `minerva sql <sql>` CLI command.
 * Reading an in-root CSV with `read_csv` there is a feature.
 */

/**
 * Who authored the SQL being checked, which decides only how a refusal is
 * worded: `model` speaks to the in-app LLM (names its tools), `note` speaks
 * to a person looking at a chart or query block in the preview or an export,
 * and `agent` speaks to an external MCP client, which has neither Minerva's
 * Tables panel nor its `describe_tables` tool — only `sql_query` itself.
 */
export type SqlGuardAudience = 'model' | 'note' | 'agent';

/** How a refusal names the thing that may not call a function. */
const SUBJECT: Record<SqlGuardAudience, string> = {
  model: 'query_sql',
  note: 'charts and query blocks in notes',
  agent: 'sql_query',
};

/** One row of the live catalog (`duckdb_tables()` ∪ `duckdb_views()`). */
export interface CatalogRelation {
  database: string;
  schema: string;
  name: string;
  /** DuckDB's own system relations (information_schema, pg_catalog, …). */
  internal: boolean;
}

export type SqlGuardVerdict = { ok: true } | { ok: false; reason: string };

/** Reads rows from the locked tables connection. */
export type RowReader = (sql: string, params: readonly string[]) => Promise<Record<string, unknown>[]>;

/**
 * Table functions a model may call. Pure generators, and read-only catalog
 * introspection (it only describes relations the model may already query).
 * Deliberately absent: `duckdb_settings` / `duckdb_databases` (paths),
 * `duckdb_secrets`, `pragma_*`, `sql_auto_complete`, and anything that
 * touches a file or evaluates SQL text.
 */
export const SAFE_TABLE_FUNCTIONS: ReadonlySet<string> = new Set([
  'range',
  'generate_series',
  'unnest',
  'duckdb_tables',
  'duckdb_views',
  'duckdb_columns',
  'duckdb_schemas',
  'duckdb_types',
  'duckdb_functions',
  'duckdb_constraints',
]);

/**
 * Scalar functions refused anywhere in the tree. None of DuckDB 1.5.3's
 * scalars read a file (`read_*` are table functions, and `getenv` does not
 * exist once external access is off), but these evaluate or plan SQL text,
 * expose configuration, or write: `json_serialize_plan` BINDS its argument,
 * which sniffs a `read_csv` target, and would leak its columns.
 */
export const REFUSED_SCALAR_FUNCTIONS: ReadonlySet<string> = new Set([
  'json_serialize_plan',
  'json_execute_serialized_sql',
  'query',
  'query_table',
  'current_setting',
  'getenv',
  'write_log',
]);
const REFUSED_SCALAR_PREFIXES = ['read_', 'parquet_', 'sniff_', 'glob'];

/** `SHOW …` forms that list the catalog and carry no relation reference. */
const SAFE_SHOW_TARGETS: ReadonlySet<string> = new Set(['"tables"', '__show_tables_expanded', '"databases"']);

const QUERY_NODES = new Set(['SELECT_NODE', 'SET_OPERATION_NODE', 'RECURSIVE_CTE_NODE']);
/** Table refs with no rule of their own: their children are visited. */
const PASS_THROUGH_REFS = new Set(['JOIN', 'SUBQUERY', 'EXPRESSION_LIST', 'EMPTY', 'PIVOT']);
/** Result modifiers and ORDER BY entries — structure, not relations. */
const STRUCTURAL_TYPES = new Set([
  'LIMIT_MODIFIER', 'LIMIT_PERCENT_MODIFIER', 'ORDER_MODIFIER', 'DISTINCT_MODIFIER',
  'ORDER_DEFAULT', 'ASCENDING', 'DESCENDING',
]);
/** Parsed-expression classes (DuckDB's `ExpressionClass`, unbound). */
const EXPRESSION_CLASSES = new Set([
  'BETWEEN', 'CASE', 'CAST', 'COLLATE', 'COLUMN_REF', 'COMPARISON', 'CONJUNCTION',
  'CONSTANT', 'DEFAULT', 'FUNCTION', 'LAMBDA', 'LAMBDA_REF', 'OPERATOR', 'PARAMETER',
  'POSITIONAL_REFERENCE', 'STAR', 'SUBQUERY', 'WINDOW',
]);

/** A plain SQL identifier: what every relation Minerva registers is named. */
const PLAIN_IDENT = /^[A-Za-z_][A-Za-z0-9_]*$/;
/** Schemas an unqualified name resolves through (DuckDB's default search path). */
const SEARCH_PATH_SCHEMAS = new Set(['main', 'pg_catalog']);

class Refusal extends Error {}

type Json = unknown;
type JsonObject = Record<string, Json>;

function isObject(v: Json): v is JsonObject {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function str(v: Json): string {
  return typeof v === 'string' ? v : '';
}

/** A LogicalType (`{ id, type_info }`) — a CAST target or a constant's type. */
function isLogicalType(o: JsonObject): boolean {
  return typeof o.id === 'string' && 'type_info' in o;
}

class Walker {
  constructor(
    private readonly catalog: readonly CatalogRelation[],
    private readonly subject: string,
  ) {}

  visit(v: Json, scope: ReadonlySet<string>): void {
    if (Array.isArray(v)) {
      for (const item of v) this.visit(item, scope);
      return;
    }
    if (!isObject(v)) return;
    if (isLogicalType(v)) return;

    if (typeof v.class === 'string') {
      this.expression(v, scope);
      return;
    }
    if (typeof v.type === 'string') {
      this.typed(v, v.type, scope);
      return;
    }
    // A plain container (a statement wrapper, a CTE entry, a pivot entry, a
    // constant's value): nothing to check here, but its children are.
    this.children(v, scope);
  }

  private children(o: JsonObject, scope: ReadonlySet<string>, skip: readonly string[] = []): void {
    for (const [k, child] of Object.entries(o)) {
      if (!skip.includes(k)) this.visit(child, scope);
    }
  }

  private expression(o: JsonObject, scope: ReadonlySet<string>): void {
    const cls = str(o.class);
    if (!EXPRESSION_CLASSES.has(cls)) throw new Refusal(`unsupported expression kind ${cls}`);
    if (cls === 'FUNCTION') {
      const name = str(o.function_name).toLowerCase();
      if (REFUSED_SCALAR_FUNCTIONS.has(name) || REFUSED_SCALAR_PREFIXES.some((p) => name.startsWith(p))) {
        throw new Refusal(`the function ${name}() is not available to ${this.subject}`);
      }
    }
    this.children(o, scope);
  }

  private typed(o: JsonObject, type: string, scope: ReadonlySet<string>): void {
    if (QUERY_NODES.has(type)) return this.queryNode(o, type, scope);
    switch (type) {
      case 'BASE_TABLE':
        this.baseTable(o, scope);
        return this.children(o, scope);
      case 'TABLE_FUNCTION':
        return this.tableFunction(o, scope);
      case 'SHOW_REF':
        return this.showRef(o, scope);
    }
    if (PASS_THROUGH_REFS.has(type) || STRUCTURAL_TYPES.has(type)) return this.children(o, scope);
    throw new Refusal(`unsupported query element ${type}`);
  }

  private queryNode(o: JsonObject, type: string, outer: ReadonlySet<string>): void {
    const scope = new Set(outer);
    const cteMap = isObject(o.cte_map) ? o.cte_map.map : [];
    if (!Array.isArray(cteMap)) throw new Refusal('unsupported CTE list');
    for (const entry of cteMap) {
      if (!isObject(entry) || typeof entry.key !== 'string') throw new Refusal('unsupported CTE entry');
      // The body sees earlier siblings only — not itself, not later ones.
      this.visit(entry.value, scope);
      scope.add(entry.key.toLowerCase());
    }
    if (type === 'RECURSIVE_CTE_NODE') {
      // The recursive arm (`right`) may name the CTE itself; the anchor may not.
      const self = str(o.cte_name).toLowerCase();
      this.visit(o.left, scope);
      this.visit(o.right, self ? new Set([...scope, self]) : scope);
      return this.children(o, scope, ['cte_map', 'left', 'right']);
    }
    this.children(o, scope, ['cte_map']);
  }

  private baseTable(o: JsonObject, scope: ReadonlySet<string>): void {
    const catalog = str(o.catalog_name);
    const schema = str(o.schema_name);
    const name = str(o.table_name);
    const shown = [catalog, schema, name].filter(Boolean).join('.');
    if (![catalog, schema, name].every((p) => p === '' || PLAIN_IDENT.test(p)) || !name) {
      throw new Refusal(`"${shown}" is not a registered table or view`);
    }
    if (!this.resolves(catalog.toLowerCase(), schema.toLowerCase(), name.toLowerCase(), scope)) {
      throw new Refusal(`"${shown}" is not a registered table or view`);
    }
  }

  private resolves(catalog: string, schema: string, name: string, scope: ReadonlySet<string>): boolean {
    const rows = this.catalog.filter((r) => r.name.toLowerCase() === name);
    const db = (r: CatalogRelation) => r.database.toLowerCase();
    const sc = (r: CatalogRelation) => r.schema.toLowerCase();
    if (!catalog && !schema) return scope.has(name) || rows.some((r) => SEARCH_PATH_SCHEMAS.has(sc(r)));
    // `a.b` is schema `a`, or database `a` with its default schema.
    if (!catalog) return rows.some((r) => sc(r) === schema || (db(r) === schema && sc(r) === 'main'));
    return rows.some((r) => db(r) === catalog && sc(r) === schema);
  }

  private tableFunction(o: JsonObject, scope: ReadonlySet<string>): void {
    const fn = o.function;
    if (!isObject(fn) || fn.class !== 'FUNCTION') throw new Refusal('unsupported table function call');
    const name = str(fn.function_name).toLowerCase();
    if (str(fn.schema) || str(fn.catalog) || !SAFE_TABLE_FUNCTIONS.has(name)) {
      const shown = [str(fn.catalog), str(fn.schema), name].filter(Boolean).join('.');
      throw new Refusal(`the table function ${shown}() is not available to ${this.subject}`);
    }
    // Arguments may hold subqueries and scalar calls of their own.
    this.children(fn, scope);
    this.children(o, scope, ['function']);
  }

  private showRef(o: JsonObject, scope: ReadonlySet<string>): void {
    const target = str(o.table_name);
    if (o.query === null || o.query === undefined) {
      // SHOW TABLES / SHOW ALL TABLES / SHOW DATABASES / SHOW TABLES FROM s.
      const listing = str(o.show_type) === 'SHOW_FROM' ? target === '' : SAFE_SHOW_TARGETS.has(target);
      if (!listing) throw new Refusal(`unsupported SHOW target ${target}`);
      return;
    }
    // DESCRIBE / SUMMARIZE / SHOW <rel>: the relation is inside `query`.
    if (target !== '') throw new Refusal(`unsupported SHOW target ${target}`);
    this.children(o, scope);
  }
}

/**
 * Check a `json_serialize_sql` result against `catalog`. Pure: the caller
 * supplies both, which is what lets the tests pin raw AST fixtures.
 */
export function checkSerializedSql(
  serialized: Json,
  catalog: readonly CatalogRelation[],
  audience: SqlGuardAudience = 'model',
): SqlGuardVerdict {
  if (!isObject(serialized)) return { ok: false, reason: 'the statement could not be parsed' };
  if (serialized.error !== false) {
    const msg = str(serialized.error_message);
    return {
      ok: false,
      reason: /only select/i.test(msg)
        ? 'only a single SELECT-style query (SELECT / WITH / FROM / DESCRIBE / SUMMARIZE / SHOW TABLES) can run'
        : `the statement could not be parsed${msg ? `: ${msg}` : ''}`,
    };
  }
  const statements = serialized.statements;
  if (!Array.isArray(statements) || statements.length !== 1) {
    return { ok: false, reason: 'exactly one statement can run' };
  }
  try {
    new Walker(catalog, SUBJECT[audience]).visit(statements[0], new Set());
    return { ok: true };
  } catch (err) {
    if (err instanceof Refusal) return { ok: false, reason: err.message };
    throw err;
  }
}

const CATALOG_SQL =
  'SELECT database_name AS database, schema_name AS schema, table_name AS name, internal FROM duckdb_tables() ' +
  'UNION ALL ' +
  'SELECT database_name, schema_name, view_name, internal FROM duckdb_views()';

/** Registered (non-system) relations, for the refusal message. */
export function describeRegistered(catalog: readonly CatalogRelation[]): string {
  const names = [...new Set(catalog.filter((r) => !r.internal).map((r) => r.name))].sort();
  if (names.length === 0) return 'There are no registered tables in this thoughtbase.';
  const shown = names.slice(0, 50).map((n) => `"${n}"`).join(', ');
  const more = names.length > 50 ? ` (and ${names.length - 50} more)` : '';
  return `Registered tables and views: ${shown}${more}.`;
}

/**
 * The full refusal message: the walker's `reason`, then what IS allowed and
 * what exists to query. The model is pointed at its `describe_tables` tool; a
 * person is pointed at the Tables panel and told how to keep a CSV chart
 * working (query the CSV's registered view by name, not its path); an
 * external agent is pointed at `SHOW TABLES` / `DESCRIBE`, which run through
 * the same `sql_query` tool and pass this guard.
 */
function refusalMessage(audience: SqlGuardAudience, reason: string, catalog: readonly CatalogRelation[]): string {
  if (audience === 'agent') {
    return (
      `Refused: ${reason}. sql_query can only read the tables and views Minerva registered ` +
      '(CSV files and captioned markdown tables), plus range() / generate_series() / unnest() and the ' +
      'duckdb_tables() / duckdb_columns() catalog functions; it cannot read files by path. ' +
      describeRegistered(catalog) +
      ' Query one by name; run "SHOW TABLES" or "DESCRIBE <table>" through sql_query for their columns.'
    );
  }
  if (audience === 'note') {
    return (
      `Refused: ${reason}. Charts and query blocks in notes can only read the tables and views ` +
      'Minerva registered (CSV files and captioned markdown tables), plus range() / generate_series() / ' +
      'unnest(); they cannot read files directly. To chart a CSV, query its registered view by name ' +
      '(the Tables panel lists them) instead of its path. ' +
      describeRegistered(catalog)
    );
  }
  return (
    `Refused: ${reason}. query_sql can only read the tables and views Minerva registered ` +
    '(CSV files and captioned markdown tables), plus range() / generate_series() / unnest() and the ' +
    'duckdb_tables() / duckdb_columns() catalog functions; it cannot read files. ' +
    describeRegistered(catalog) +
    ' Call describe_tables for their columns.'
  );
}

/**
 * Parse `sql` with DuckDB (via `read`, the locked tables connection), read
 * the live catalog, and decide. The verdict's `reason` is worded for
 * `audience`: it says what is allowed and names what may be queried.
 */
export async function guardSql(
  read: RowReader,
  sql: string,
  audience: SqlGuardAudience,
): Promise<SqlGuardVerdict> {
  const [parsedRows, catalogRows] = await Promise.all([
    read('SELECT json_serialize_sql(?::VARCHAR) AS ast', [sql]),
    read(CATALOG_SQL, []),
  ]);
  const catalog: CatalogRelation[] = catalogRows.map((r) => ({
    database: str(r.database),
    schema: str(r.schema),
    name: str(r.name),
    internal: r.internal === true,
  }));
  let ast: Json;
  try {
    ast = JSON.parse(str(parsedRows[0]?.ast));
  } catch {
    ast = null;
  }
  const verdict = checkSerializedSql(ast, catalog, audience);
  if (verdict.ok) return verdict;
  return { ok: false, reason: refusalMessage(audience, verdict.reason, catalog) };
}

/** {@link guardSql} for the LLM's `query_sql` (#2442). */
export function guardModelSql(read: RowReader, sql: string): Promise<SqlGuardVerdict> {
  return guardSql(read, sql, 'model');
}
