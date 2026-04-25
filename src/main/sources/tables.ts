import fs from 'node:fs/promises';
import path from 'node:path';
import YAML from 'yaml';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { indexCsvTable, unindexCsvTable, unindexAllCsvTables, type CsvTableColumn } from '../graph/index';
import type { ProjectContext } from '../project-context-types';

interface TablesState {
  rootPath: string;
  instance: DuckDBInstance;
  connection: DuckDBConnection;
  /** relativePath → tableName for the currently-registered CSV views. */
  pathToTable: Map<string, string>;
  /** tableName → relativePath, so we can detect + warn on collisions. */
  tableToPath: Map<string, string>;
}

const states = new Map<string, TablesState>();

function getState(ctx: ProjectContext): TablesState | null {
  return states.get(ctx.rootPath) ?? null;
}

export type QueryResult =
  | { ok: true; columns: string[]; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

export interface TableInfo {
  name: string;
  relativePath: string;
  columns: string[];
  rowCount: number;
}

/** Open an in-memory DuckDB for the given project. Idempotent per project. */
export async function initTablesDb(ctx: ProjectContext): Promise<void> {
  if (states.has(ctx.rootPath)) return;
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  states.set(ctx.rootPath, {
    rootPath: ctx.rootPath,
    instance,
    connection,
    pathToTable: new Map(),
    tableToPath: new Map(),
  });
}

export async function disposeProject(ctx: ProjectContext): Promise<void> {
  const state = states.get(ctx.rootPath);
  if (!state) return;
  try { state.connection.closeSync(); } catch { /* already closed */ }
  try { state.instance.closeSync(); } catch { /* already closed */ }
  states.delete(ctx.rootPath);
}

/**
 * Execute `sql` and return rows as plain JS objects suitable for structured
 * clone across the IPC boundary. Malformed SQL or runtime errors come back
 * as `{ ok: false, error }` — never thrown.
 */
export async function runQuery(ctx: ProjectContext, sql: string): Promise<QueryResult> {
  const state = getState(ctx);
  if (!state) return { ok: false, error: 'Tables DB is not initialized' };
  try {
    const reader = await state.connection.runAndReadAll(sql);
    const columns = reader.columnNames();
    const rows = reader.getRowObjectsJS() as Record<string, unknown>[];
    return { ok: true, columns, rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

// ── CSV pipeline (#233) ─────────────────────────────────────────────────────

/**
 * Derive a DuckDB-safe table name from a CSV's relative path.
 * `notes/data/2024-experiment.csv` → `notes_data_2024_experiment`.
 * Identifiers that would start with a digit get a `t_` prefix.
 */
export function deriveTableName(relativePath: string): string {
  const withoutExt = relativePath.replace(/\.csv$/i, '');
  // Separator-ish characters collapse to a single underscore; anything else
  // non-alphanumeric just drops out.
  let name = withoutExt
    .replace(/[\/\\.\-\s]+/g, '_')
    .replace(/[^a-zA-Z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
  if (!name) name = 'table';
  if (/^[0-9]/.test(name)) name = 't_' + name;
  return name;
}

/**
 * Read a companion markdown note alongside the CSV (same dir, matching stem).
 * If the frontmatter declares `table_name:`, return it as the SQL identifier.
 * Returns null if no companion exists, no frontmatter, or no override.
 */
async function readCompanionOverride(rootPath: string, relativePath: string): Promise<string | null> {
  const dir = path.dirname(relativePath);
  const stem = path.basename(relativePath, path.extname(relativePath));
  const companionRel = dir === '.' ? `${stem}.md` : `${dir}/${stem}.md`;
  const companionAbs = path.join(rootPath, companionRel);
  let content: string;
  try {
    content = await fs.readFile(companionAbs, 'utf-8');
  } catch {
    return null;
  }
  const m = content.match(/^---\n([\s\S]*?)\n---/);
  if (!m) return null;
  try {
    const fm = YAML.parse(m[1]) as Record<string, unknown> | null;
    const raw = fm?.table_name;
    if (typeof raw === 'string' && raw.trim().length > 0) {
      // Run the user-supplied override through the same sanitizer so a
      // whitespace-happy YAML value can't produce an invalid identifier.
      return deriveTableName(raw);
    }
  } catch {
    /* malformed YAML — ignore, fall back to the derived name */
  }
  return null;
}

/**
 * Register (or re-register) a CSV file as a DuckDB view. The view is lazy —
 * DuckDB re-reads the file on every query — so content changes don't require
 * re-registration. Re-register is called when the file is added or when the
 * companion note's `table_name:` may have changed.
 */
export async function registerCsv(ctx: ProjectContext, relativePath: string): Promise<void> {
  const state = getState(ctx);
  if (!state) return;
  const { rootPath, connection, pathToTable, tableToPath } = state;
  const override = await readCompanionOverride(rootPath, relativePath);
  const tableName = override ?? deriveTableName(relativePath);

  // If another path already claimed this table name, warn and skip rather
  // than silently clobbering whichever one loaded first.
  const existingPath = tableToPath.get(tableName);
  if (existingPath && existingPath !== relativePath) {
    console.warn(
      `[tables] Table name collision: '${tableName}' would be used by both ` +
      `'${existingPath}' and '${relativePath}'. Skipping the second. Use ` +
      `'table_name:' in a companion .md to disambiguate.`,
    );
    return;
  }

  // If this path was previously registered under a different name (e.g. the
  // companion override was just added or changed), drop the old view first.
  const previousName = pathToTable.get(relativePath);
  if (previousName && previousName !== tableName) {
    try {
      await connection.run(`DROP VIEW IF EXISTS "${previousName}"`);
    } catch { /* tolerate the rare rename race */ }
    tableToPath.delete(previousName);
    unindexCsvTable(ctx, previousName);
  }

  const absPath = path.join(rootPath, relativePath);
  const escapedPath = absPath.replace(/'/g, "''");
  try {
    await connection.run(
      `CREATE OR REPLACE VIEW "${tableName}" AS SELECT * FROM read_csv_auto('${escapedPath}')`,
    );
    pathToTable.set(relativePath, tableName);
    tableToPath.set(tableName, relativePath);
    // Reflect the shape into the knowledge graph (CSVW + OWL). This
    // lets SPARQL consumers ask "what tables do I have?", "what columns
    // does X expose?", and reason about column datatypes.
    await indexCsvTableShape(ctx, relativePath, tableName);
  } catch (err) {
    console.warn(
      `[tables] Failed to register '${relativePath}' as '${tableName}': ` +
      (err instanceof Error ? err.message : String(err)),
    );
  }
}

/**
 * Fetch column names + DuckDB types from information_schema and write
 * the corresponding CSVW/OWL triples to the graph. Failures here log but
 * don't throw — the CSV is still queryable via SQL even if the graph
 * entry didn't land.
 */
async function indexCsvTableShape(ctx: ProjectContext, relativePath: string, tableName: string): Promise<void> {
  const state = getState(ctx);
  if (!state) return;
  const safeName = tableName.replace(/'/g, "''");
  try {
    const reader = await state.connection.runAndReadAll(
      `SELECT column_name, data_type, ordinal_position ` +
      `FROM information_schema.columns ` +
      `WHERE table_name = '${safeName}' AND table_schema = 'main' ` +
      `ORDER BY ordinal_position`,
    );
    const rows = reader.getRowObjectsJS() as Record<string, unknown>[];
    const columns: CsvTableColumn[] = rows.map((r) => ({
      name: String(r.column_name),
      duckdbType: String(r.data_type),
      // ordinal_position is 1-based in DuckDB; we publish 0-based.
      index: Number(r.ordinal_position) - 1,
    }));
    indexCsvTable(ctx, { tableName, relativePath, columns });
  } catch (err) {
    console.warn(
      `[tables] Failed to index '${tableName}' into graph: ` +
      (err instanceof Error ? err.message : String(err)),
    );
  }
}

/** Drop the view for a CSV path. No-op if the path was never registered. */
export async function unregisterCsv(ctx: ProjectContext, relativePath: string): Promise<void> {
  const state = getState(ctx);
  if (!state) return;
  const { connection, pathToTable, tableToPath } = state;
  const tableName = pathToTable.get(relativePath);
  if (!tableName) return;
  try {
    await connection.run(`DROP VIEW IF EXISTS "${tableName}"`);
  } catch { /* view may already be gone */ }
  pathToTable.delete(relativePath);
  tableToPath.delete(tableName);
  unindexCsvTable(ctx, tableName);
}

/**
 * Scan the thoughtbase on project open and register every `.csv` file under
 * the root. Mirrors graph.indexAllNotes's walker shape.
 */
export async function registerAllCsvs(ctx: ProjectContext): Promise<number> {
  const state = getState(ctx);
  if (!state) return 0;
  const { rootPath } = state;
  // Wipe stale CSV-table triples up front so CSVs deleted while the app
  // was closed don't linger in the graph after a full rescan. Each
  // registered CSV writes its own triples as it goes.
  unindexAllCsvTables(ctx);
  let count = 0;
  async function walk(dirPath: string) {
    let entries: import('node:fs').Dirent[];
    try {
      entries = await fs.readdir(dirPath, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.csv')) {
        const rel = path.relative(rootPath, fullPath);
        await registerCsv(ctx, rel);
        count++;
      }
    }
  }
  await walk(rootPath);
  return count;
}

/** Every registered CSV's table name, relative path, column names, and row count. */
export async function listTables(ctx: ProjectContext): Promise<TableInfo[]> {
  const state = getState(ctx);
  if (!state) return [];
  const out: TableInfo[] = [];
  for (const [relativePath, name] of state.pathToTable.entries()) {
    const quoted = `"${name}"`;
    const countR = await runQuery(ctx, `SELECT COUNT(*) AS n FROM ${quoted}`);
    const colsR = await runQuery(ctx,
      `SELECT column_name FROM information_schema.columns ` +
      `WHERE table_name = '${name.replace(/'/g, "''")}' AND table_schema = 'main' ` +
      `ORDER BY ordinal_position`,
    );
    const rowCount = countR.ok ? Number(countR.rows[0]?.n ?? 0) : 0;
    const columns = colsR.ok ? colsR.rows.map((r) => String(r.column_name)) : [];
    out.push({ name, relativePath, columns, rowCount });
  }
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  return out;
}

/** Exposed for tests. */
export function _isOpen(ctx: ProjectContext): boolean {
  return states.has(ctx.rootPath);
}
