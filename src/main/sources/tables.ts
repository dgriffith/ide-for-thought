import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';

// ── Module state ────────────────────────────────────────────────────────────
// Matches the `graph` module: single live project at a time. If Minerva ever
// grows true multi-project-per-process, both modules move in lockstep.

let instance: DuckDBInstance | null = null;
let connection: DuckDBConnection | null = null;
let currentRootPath: string | null = null;

export type QueryResult =
  | { ok: true; columns: string[]; rows: Record<string, unknown>[] }
  | { ok: false; error: string };

/** Open an in-memory DuckDB for the given project root. Idempotent per root. */
export async function initTablesDb(rootPath: string): Promise<void> {
  if (currentRootPath === rootPath && connection) return;
  await closeTablesDb();
  instance = await DuckDBInstance.create(':memory:');
  connection = await instance.connect();
  currentRootPath = rootPath;
}

export async function closeTablesDb(): Promise<void> {
  try { connection?.closeSync(); } catch { /* already closed */ }
  try { instance?.closeSync(); } catch { /* already closed */ }
  connection = null;
  instance = null;
  currentRootPath = null;
}

/**
 * Execute `sql` and return rows as plain JS objects suitable for structured
 * clone across the IPC boundary. Malformed SQL or runtime errors come back
 * as `{ ok: false, error }` — never thrown.
 */
export async function runQuery(sql: string): Promise<QueryResult> {
  if (!connection) return { ok: false, error: 'Tables DB is not initialized' };
  try {
    const reader = await connection.runAndReadAll(sql);
    const columns = reader.columnNames();
    const rows = reader.getRowObjectsJS() as Record<string, unknown>[];
    return { ok: true, columns, rows };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Register a CSV file as a queryable view. Full implementation lands in the
 * CSV ingestion ticket (#233); this is a stub so IPC + lifecycle can be wired
 * against the final signature.
 */
export async function registerCsv(_relativePath: string, _tableName: string): Promise<void> {
  throw new Error('registerCsv not yet implemented (see issue #233)');
}

/** Exposed for tests. */
export function _isOpen(): boolean {
  return connection !== null;
}
