/**
 * A private DuckDB that types CSV text with DuckDB's own CSV sniffer (#2437).
 *
 * ── Why this exists ─────────────────────────────────────────────────────────
 * A captioned markdown table (#1357) has no backing file, but it has to come
 * out of SQL with the same column types a standalone `.csv` gets — a numeric
 * column numeric, a date column a DATE. The loader used to get that by writing
 * the cells to a temp CSV in `os.tmpdir()` and `read_csv_auto`-ing it on the
 * shared tables connection. #2437 locks that connection to the thoughtbase
 * root (`allowed_directories` + `enable_external_access = false`), so the
 * shared connection can no longer see the temp dir.
 *
 * Re-implementing the sniffer's type choice in JS or with `TRY_CAST` does not
 * give parity. Measured on DuckDB 1.5.3: `yes`/`no` sniff as BOOLEAN, `007` as
 * VARCHAR, `+1` and `1_000` as VARCHAR, a 20-digit integer as DOUBLE — `TRY_CAST`
 * disagrees on four of those, and the rules move with DuckDB versions. So the
 * sniffer still does the typing, just not on the shared connection:
 *
 *   1. write the CSV text into a private `mkdtemp` directory (0700);
 *   2. `read_csv_auto` it on THIS instance, which is locked to that directory
 *      and runs no SQL but the one fixed statement below;
 *   3. hand the typed result to the caller's connection as data chunks
 *      through an appender — no file access on the shared connection at all.
 *
 * The values transferred are the sniffer's own parsed values, so the table's
 * types and contents are identical to what `read_csv_auto` produced before.
 */
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import type { DuckDBConnection } from '@duckdb/node-api';
import { duckdb } from '../duckdb-lazy';
import { lockToDirectories } from './duckdb-lockdown';
import { logger } from '../../shared/logger';

export interface CsvSniffer {
  /**
   * Create (or replace) `tableName` on `target` from `csvText`, typed by the
   * sniffer. The text must carry a header row.
   */
  loadInto(target: DuckDBConnection, tableName: string, csvText: string): Promise<void>;
  /** Close the private instance and remove its directory. Idempotent. */
  close(): Promise<void>;
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

/** `parentDir` is where the private directory is made; tests point it somewhere they own. */
export async function createCsvSniffer(parentDir: string = os.tmpdir()): Promise<CsvSniffer> {
  // mkdtemp creates the directory 0700.
  const dir = await fs.mkdtemp(path.join(parentDir, 'minerva-sniff-'));
  const { DuckDBInstance } = await duckdb();
  const instance = await DuckDBInstance.create(':memory:');
  const connection = await instance.connect();
  let closed = false;
  const close = async () => {
    if (closed) return;
    closed = true;
    try { connection.closeSync(); } catch { /* already closed */ }
    try { instance.closeSync(); } catch { /* already closed */ }
    await fs.rm(dir, { recursive: true, force: true });
  };
  try {
    await lockToDirectories(connection, [dir]);
  } catch (err) {
    await close();
    throw err;
  }

  return {
    close,
    async loadInto(target, tableName, csvText) {
      const file = path.join(dir, `${crypto.randomUUID()}.csv`);
      await fs.writeFile(file, csvText, { encoding: 'utf-8', flag: 'wx' });
      try {
        // header=true: the caller always emits a header row, so don't leave it
        // to sniffing. null_padding=true: tolerate short rows in a hand-written
        // markdown table. Same options the pre-#2437 loader used.
        const result = await connection.run(
          `SELECT * FROM read_csv_auto('${file.replace(/'/g, "''")}', header=true, null_padding=true)`,
        );
        const names = result.columnNames();
        const types = result.columnTypes();
        const ddl = names.map((n, i) => `${quoteIdent(n)} ${types[i]!.toString()}`).join(', ');
        await target.run(`CREATE OR REPLACE TABLE ${quoteIdent(tableName)} (${ddl})`);
        try {
          const appender = await target.createAppender(tableName);
          try {
            for (;;) {
              const chunk = await result.fetchChunk();
              if (!chunk || chunk.rowCount === 0) break;
              appender.appendDataChunk(chunk);
            }
            appender.flushSync();
          } finally {
            appender.closeSync();
          }
        } catch (err) {
          // Don't leave a half-filled table behind under a name the caller
          // won't record as registered.
          await target.run(`DROP TABLE IF EXISTS ${quoteIdent(tableName)}`).catch((dropErr: unknown) => {
            logger('tables').warn(`could not drop half-loaded table '${tableName}':`, dropErr);
          });
          throw err;
        }
      } finally {
        await fs.rm(file, { force: true });
      }
    },
  };
}
