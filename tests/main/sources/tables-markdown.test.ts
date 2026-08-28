import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  initTablesDb,
  disposeProject,
  runQuery,
  registerCsv,
  unregisterCsv,
  registerMarkdownTable,
  unregisterNoteTables,
  reregisterNoteTables,
  onCsvTableCollision,
  listTables,
} from '../../../src/main/sources/tables';
import { projectContext } from '../../../src/main/project-context-types';
import type { ParsedTable } from '../../../src/main/graph/parser';

let rootPath: string;
let ctx: ReturnType<typeof projectContext>;

beforeAll(async () => {
  rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-mdtable-test-'));
  ctx = projectContext(rootPath);
  await initTablesDb(ctx);
});

afterAll(async () => {
  disposeProject(ctx);
  await fs.rm(rootPath, { recursive: true, force: true });
});

// The DuckDB instance is shared across every test in this file (a fresh one
// per test would re-pay initTablesDb's startup cost for no benefit here), so
// nothing stops one test's tables from colliding with the next's. Drop
// everything through the real unregister paths after each test — that
// exercises the same cleanup production code relies on, rather than
// depending on every test picking a disjoint name forever (#1944).
afterEach(async () => {
  const tables = await listTables(ctx);
  const notePaths = new Set(tables.filter((t) => t.source === 'note').map((t) => t.relativePath));
  const csvPaths = new Set(tables.filter((t) => t.source === 'csv').map((t) => t.relativePath));
  for (const notePath of notePaths) await unregisterNoteTables(ctx, notePath);
  for (const csvPath of csvPaths) await unregisterCsv(ctx, csvPath);
});

function table(caption: string, headers: string[], rows: string[][]): ParsedTable {
  // Mirror what the parser produces for a captioned table.
  const name = caption.replace(/\s+/g, '_');
  return { headers, rows, caption, name };
}

describe('registerMarkdownTable (#1357)', () => {
  it('materializes rows with inferred types (numbers as numbers)', async () => {
    const t = table('sales', ['item', 'amount'], [['a', '10'], ['b', '20']]);
    const res = await registerMarkdownTable(ctx, 'notes/q3.md', t, 0);
    expect(res.ok).toBe(true);

    const sum = await runQuery(ctx, 'SELECT sum(amount) AS total FROM sales');
    expect(sum.ok).toBe(true);
    // DuckDB infers `amount` as an integer column and sums to a BigInt.
    if (sum.ok) expect(Number(sum.rows[0]!.total)).toBe(30);

    const shape = await runQuery(ctx, "SELECT data_type FROM information_schema.columns WHERE table_name = 'sales' AND column_name = 'amount'");
    if (shape.ok) expect(String(shape.rows[0]!.data_type)).toMatch(/INT|BIGINT/i);
  });

  it('skips an uncaptioned table', async () => {
    const res = await registerMarkdownTable(ctx, 'notes/x.md', { headers: ['a'], rows: [['1']] }, 0);
    expect(res).toEqual({ ok: false, reason: 'uncaptioned' });
  });

  it('re-registering a note replaces its tables cleanly', async () => {
    const md = 'Table: metrics\n| k | v |\n|---|---|\n| x | 1 |\n| y | 2 |';
    const first = await reregisterNoteTables(ctx, 'notes/m.md', md);
    expect(first.count).toBe(1);
    let r = await runQuery(ctx, 'SELECT count(*) AS n FROM metrics');
    if (r.ok) expect(Number(r.rows[0]!.n)).toBe(2);

    // Edit: fewer rows, same caption.
    const edited = 'Table: metrics\n| k | v |\n|---|---|\n| z | 9 |';
    await reregisterNoteTables(ctx, 'notes/m.md', edited);
    r = await runQuery(ctx, 'SELECT count(*) AS n FROM metrics');
    if (r.ok) expect(Number(r.rows[0]!.n)).toBe(1);
  });

  it('removes the table when the caption is dropped on edit', async () => {
    await reregisterNoteTables(ctx, 'notes/drop.md', 'Table: gone\n| a | b |\n|---|---|\n| 1 | 2 |');
    expect((await runQuery(ctx, 'SELECT * FROM gone')).ok).toBe(true);

    await reregisterNoteTables(ctx, 'notes/drop.md', '| a | b |\n|---|---|\n| 1 | 2 |'); // no caption
    expect((await runQuery(ctx, 'SELECT * FROM gone')).ok).toBe(false);
  });

  it('unregisterNoteTables drops every table for a note', async () => {
    const md = 'Table: t_one\n| a | c |\n|---|---|\n| 1 | 2 |\n\nText\n\nTable: t_two\n| b | d |\n|---|---|\n| 2 | 3 |';
    await reregisterNoteTables(ctx, 'notes/multi.md', md);
    expect((await runQuery(ctx, 'SELECT * FROM t_one')).ok).toBe(true);
    expect((await runQuery(ctx, 'SELECT * FROM t_two')).ok).toBe(true);

    await unregisterNoteTables(ctx, 'notes/multi.md');
    expect((await runQuery(ctx, 'SELECT * FROM t_one')).ok).toBe(false);
    expect((await runQuery(ctx, 'SELECT * FROM t_two')).ok).toBe(false);
  });

  it('detects a collision with a CSV table and skips the markdown table', async () => {
    // Register a CSV named `revenue`.
    await fs.writeFile(path.join(rootPath, 'revenue.csv'), 'x,y\n1,2\n', 'utf-8');
    const csv = await registerCsv(ctx, 'revenue.csv');
    expect(csv.ok).toBe(true);

    const collisions: unknown[] = [];
    const unsub = onCsvTableCollision(rootPath, (c) => collisions.push(c));
    const res = await registerMarkdownTable(
      ctx,
      'notes/clash.md',
      table('revenue', ['a'], [['9']]),
      0,
    );
    unsub();

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe('collision');
    expect(collisions).toHaveLength(1);
    // CSV wins — the table still resolves to the CSV's columns, not the note's.
    const cols = await runQuery(ctx, "SELECT column_name FROM information_schema.columns WHERE table_name = 'revenue' ORDER BY ordinal_position");
    if (cols.ok) expect(cols.rows.map((r) => r.column_name)).toEqual(['x', 'y']);
  });

  it('skips a same-note duplicate caption without firing a cross-source toast', async () => {
    const collisions: unknown[] = [];
    const unsub = onCsvTableCollision(rootPath, (c) => collisions.push(c));
    const md = 'Table: dup\n| a | c |\n|---|---|\n| 1 | 2 |\n\nTable: dup\n| b | d |\n|---|---|\n| 2 | 3 |';
    const out = await reregisterNoteTables(ctx, 'notes/dup.md', md);
    unsub();
    expect(out.count).toBe(1); // only the first `dup` registers
    expect(collisions).toHaveLength(0); // same-note dup is quiet
  });
});
