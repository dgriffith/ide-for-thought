/**
 * File-access lockdown for a DuckDB connection (#2437).
 *
 * The shared tables DuckDB backs the Query panel, ```sql cells, the Python
 * RPC bridge's `minerva.sql()`, vega specs and the LLM's `query_sql` tool.
 * DuckDB's file table functions (`read_text`, `read_blob`, `read_csv`,
 * `read_json`, `read_parquet`, `glob`) plus `COPY … TO`, `ATTACH` and
 * `EXPORT DATABASE` take absolute paths, so without this any of those callers
 * — including a prompt-injected model — could read or write anywhere the user
 * can.
 *
 * Three settings, in this order:
 *
 *   - `allowed_directories` — the only directories file access may reach.
 *     DuckDB resolves the target (following symlinks, collapsing `..`) before
 *     comparing, so every entry must be a realpath with a trailing `/`: a
 *     non-canonical entry would match nothing, and without the slash
 *     `/notes` would also admit `/notes-private`.
 *   - `enable_external_access = false` — turns the allowlist on and refuses
 *     everything else: other local paths, `http(s)://`/`s3://`, extension
 *     `INSTALL`/`LOAD`.
 *   - `lock_configuration = true` — makes both of the above permanent for the
 *     instance. `SET`/`RESET`/`PRAGMA` of any option fails afterwards, from
 *     this connection or any other one on the same instance.
 *
 * The shared tables instance is locked to the thoughtbase root ONLY. That is
 * deliberate: `query_sql` is an LLM tool with no approval gate, so a directory
 * any caller of this connection can read is a directory a prompt injection
 * can read. SQL that wants a file from elsewhere copies it into the
 * thoughtbase, or reads it from a Python cell — the kernel is a separate
 * process and is not affected. A CSV inside the root that is a symlink to a
 * file outside it no longer registers: the same rule `assertSafePath` applies
 * to every other reader (#2357).
 *
 * The lock cannot exclude a subdirectory of the root, so `<root>/.minerva/`
 * stays readable here. `query_sql` is closed off from it separately, by the
 * relation allowlist in `llm-sql-guard.ts` (#2442).
 *
 * Verified against DuckDB 1.5.3 in `tests/main/sources/tables-lockdown.test.ts`.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import type { DuckDBConnection } from '@duckdb/node-api';

/** A SQL string literal: single-quoted, embedded quotes doubled. */
export function sqlStringLiteral(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * The lockdown statements for `realDirs`, which the caller has already
 * realpath'd. A trailing separator is added here.
 */
export function fileLockdownSql(realDirs: readonly string[]): string {
  if (realDirs.length === 0) throw new Error('fileLockdownSql needs at least one directory');
  const list = realDirs
    .map((d) => sqlStringLiteral(d.endsWith(path.sep) ? d : `${d}${path.sep}`))
    .join(', ');
  return (
    `SET allowed_directories = [${list}]; ` +
    'SET enable_external_access = false; ' +
    'SET lock_configuration = true;'
  );
}

/**
 * Lock `connection`'s whole instance to `dirs`. Each is realpath'd first,
 * because DuckDB resolves every target before the prefix check (macOS tmp:
 * `/var` → `/private/var`). Run it before any query from outside the app.
 */
export async function lockToDirectories(connection: DuckDBConnection, dirs: readonly string[]): Promise<void> {
  const real = await Promise.all(dirs.map((d) => fs.realpath(d)));
  await connection.run(fileLockdownSql(real));
}
