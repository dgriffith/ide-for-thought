/**
 * `listTables` query shape (#2227).
 *
 * The defect these guard: `listTables` used to call a per-table `tableShape`
 * helper that issued two sequential queries — an `information_schema` lookup
 * and a `COUNT(*)` — so the DuckDB round-trip count was `2N`, and because a
 * CSV is registered as a *lazy view* each of those `COUNT(*)`s re-read and
 * re-sniffed the entire file. `listTables` runs on `TABLES_LIST`, on the
 * `describe_tables` LLM tool, and on every `TABLES_CHANGED` broadcast — and
 * `TABLES_CHANGED` fires for things no CSV was involved in, so a thoughtbase
 * with 40 CSVs re-parsed all 40 of them whenever a note with a captioned
 * table was saved.
 *
 * These are **count** assertions, not timing ones, per #2229: "this path
 * issues one query per table, not two" is a gate that means the same thing on
 * a loaded CI box as on an idle laptop, which a millisecond threshold is not.
 *
 * Counting requires patching `DuckDBConnection.prototype.runAndReadAll`
 * rather than spying on the module: `listTables` calls its own module-local
 * `runQuery`, which an ESM export spy cannot intercept. `runAndReadAll`
 * internally calls `run`, so only the former is counted — patching both
 * double-counts every query.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { DuckDBConnection } from '@duckdb/node-api';
import {
  initTablesDb,
  disposeProject,
  registerCsv,
  unregisterCsv,
  listTables,
  reregisterNoteTables,
} from '../../../src/main/sources/tables';
import { initGraph } from '../../../src/main/graph/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

let root: string;
let ctx: ProjectContext;

/** Count the SQL statements `fn` sends to DuckDB, restoring the patch after. */
async function countQueries<T>(fn: () => Promise<T>): Promise<{ result: T; sql: string[] }> {
  const sql: string[] = [];
  const original = DuckDBConnection.prototype.runAndReadAll;
  /* eslint-disable @typescript-eslint/no-explicit-any */
  DuckDBConnection.prototype.runAndReadAll = function (this: any, statement: any, ...rest: any[]) {
    sql.push(String(statement));
    return original.call(this, statement, ...rest);
  } as typeof DuckDBConnection.prototype.runAndReadAll;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  try {
    return { result: await fn(), sql };
  } finally {
    DuckDBConnection.prototype.runAndReadAll = original;
  }
}

async function writeCsv(rel: string, body: string): Promise<void> {
  const abs = path.join(root, rel);
  await fsp.mkdir(path.dirname(abs), { recursive: true });
  await fsp.writeFile(abs, body, 'utf-8');
}

beforeEach(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-tables-listq-'));
  ctx = projectContext(root);
  await initGraph(ctx);
  await initTablesDb(ctx);
});

afterEach(() => {
  disposeProject(ctx);
  fs.rmSync(root, { recursive: true, force: true });
});

describe('listTables query shape (#2227)', () => {
  it('issues a bounded number of queries regardless of how many CSVs are registered', async () => {
    for (let i = 0; i < 6; i++) {
      await writeCsv(`data${i}.csv`, 'x,y\n1,2\n3,4\n5,6\n');
      await registerCsv(ctx, `data${i}.csv`);
    }

    const { result, sql } = await countQueries(() => listTables(ctx));

    expect(result).toHaveLength(6);
    // Two: one `information_schema` sweep for all six tables' columns, one
    // batched `UNION ALL` of their counts. The old shape was 12.
    expect(sql).toHaveLength(2);
    expect(sql.filter((s) => /COUNT\(\*\)/.test(s))).toHaveLength(1);
    expect(sql.filter((s) => /information_schema/.test(s))).toHaveLength(1);
    expect(result.every((t) => t.rowCount === 3)).toBe(true);
    expect(result.every((t) => t.columns.join() === 'x,y')).toBe(true);
  });

  it('re-lists unchanged CSVs without re-counting a single one', async () => {
    for (let i = 0; i < 4; i++) {
      await writeCsv(`data${i}.csv`, 'x\n1\n2\n');
      await registerCsv(ctx, `data${i}.csv`);
    }
    await listTables(ctx); // warm the row-count cache

    const { result, sql } = await countQueries(() => listTables(ctx));

    // The whole point of the cache: a refresh that follows an unrelated
    // TABLES_CHANGED must not re-parse any CSV. No COUNT(*) at all.
    expect(sql.filter((s) => /COUNT\(\*\)/.test(s))).toHaveLength(0);
    expect(sql).toHaveLength(1);
    expect(result.map((t) => t.rowCount)).toEqual([2, 2, 2, 2]);
  });

  it('re-counts only the CSV that changed', async () => {
    for (let i = 0; i < 4; i++) {
      await writeCsv(`data${i}.csv`, 'x\n1\n2\n');
      await registerCsv(ctx, `data${i}.csv`);
    }
    await listTables(ctx);

    // What the watcher does on a CSV write: rewrite, then re-register.
    await writeCsv('data2.csv', 'x\n1\n2\n3\n4\n');
    await registerCsv(ctx, 'data2.csv');

    const { result, sql } = await countQueries(() => listTables(ctx));

    const counts = sql.filter((s) => /COUNT\(\*\)/.test(s));
    expect(counts).toHaveLength(1);
    // One batched statement, and it names only the changed table.
    expect(counts[0]).toContain('"data2"');
    expect(counts[0]).not.toContain('"data1"');
    expect(result.find((t) => t.name === 'data2')?.rowCount).toBe(4);
    expect(result.find((t) => t.name === 'data1')?.rowCount).toBe(2);
  });

  it('notices an out-of-band CSV rewrite that never went through registerCsv', async () => {
    // registerCsv is the primary invalidation, but a file can change with no
    // watcher running (a git checkout while the app is closed, a `cp` into the
    // thoughtbase). mtime+size is the backstop, so the count must still move.
    await writeCsv('data.csv', 'x\n1\n2\n');
    await registerCsv(ctx, 'data.csv');
    expect((await listTables(ctx))[0]!.rowCount).toBe(2);

    await writeCsv('data.csv', 'x\n1\n2\n3\n4\n5\n');
    expect((await listTables(ctx))[0]!.rowCount).toBe(5);
  });

  it('re-counts when a schema sidecar changes the row count but the CSV does not', async () => {
    // The case mtime+size cannot see: `header: false` turns the header line
    // into a data row, so the count moves while the .csv is byte-identical.
    // The watcher routes a sidecar edit to registerCsv (reregisterSibling),
    // and registerCsv dropping the cached entry is the only thing that makes
    // this land.
    await writeCsv('data.csv', 'x\n1\n2\n');
    await registerCsv(ctx, 'data.csv');
    expect((await listTables(ctx))[0]!.rowCount).toBe(2);

    await writeCsv('data.csv.schema.yaml', 'columns:\n  c1: VARCHAR\nheader: false\n');
    await registerCsv(ctx, 'data.csv');
    expect((await listTables(ctx))[0]!.rowCount).toBe(3);
  });

  it('reports the new count after a delete-then-recreate cycle', async () => {
    // Honest scope note: `unregisterCsv` also drops the cached entry, but no
    // test can isolate that line — a path can only be re-listed after a
    // re-registration, and `registerCsv` invalidates on its own. This covers
    // the user-visible round trip; the delete in `unregisterCsv` is a leak
    // guard, documented as such at its call site.
    await writeCsv('data.csv', 'x\n1\n2\n');
    await registerCsv(ctx, 'data.csv');
    await listTables(ctx);

    await unregisterCsv(ctx, 'data.csv');
    expect(await listTables(ctx)).toEqual([]);

    await writeCsv('data.csv', 'x\n1\n2\n3\n');
    await registerCsv(ctx, 'data.csv');
    expect((await listTables(ctx))[0]!.rowCount).toBe(3);
  });

  it('keeps every other table correct when one table cannot be counted', async () => {
    // The batched UNION ALL is all-or-nothing: if one branch errors the whole
    // statement fails. Without the per-table fallback that reports 0 rows for
    // EVERY table — a visibly wrong panel rather than a slow one.
    await writeCsv('good.csv', 'x\n1\n2\n3\n');
    await writeCsv('gone.csv', 'x\n1\n');
    await registerCsv(ctx, 'good.csv');
    await registerCsv(ctx, 'gone.csv');

    // Delete the backing file without unregistering — the window the watcher
    // has not caught up in yet.
    await fsp.rm(path.join(root, 'gone.csv'));

    const result = await listTables(ctx);
    expect(result.find((t) => t.name === 'good')?.rowCount).toBe(3);
    expect(result.find((t) => t.name === 'gone')?.rowCount).toBe(0);
  });

  it('counts note tables and CSVs in the same batched query', async () => {
    await writeCsv('data.csv', 'x\n1\n2\n');
    await registerCsv(ctx, 'data.csv');
    await reregisterNoteTables(ctx, 'note.md',
      'Table: Readings\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n');

    const { result, sql } = await countQueries(() => listTables(ctx));

    expect(sql).toHaveLength(2);
    const csv = result.find((t) => t.source === 'csv');
    const note = result.find((t) => t.source === 'note');
    expect(csv?.rowCount).toBe(2);
    expect(note?.rowCount).toBe(2);
    expect(note?.columns).toEqual(['a', 'b']);
  });

  it('reports rowCount as a JS number, not a DuckDB BigInt', async () => {
    // DuckDB hands COUNT(*) back as BigInt; a raw one on TableInfo throws in
    // JSON.stringify and so would break the IPC hop to the Tables panel. Both
    // the batched path and the cached path have to coerce.
    await writeCsv('data.csv', 'x\n1\n2\n');
    await registerCsv(ctx, 'data.csv');

    const fresh = await listTables(ctx);
    expect(typeof fresh[0]!.rowCount).toBe('number');
    expect(() => JSON.stringify(fresh)).not.toThrow();

    const cached = await listTables(ctx);
    expect(typeof cached[0]!.rowCount).toBe('number');
    expect(() => JSON.stringify(cached)).not.toThrow();
  });
});
