/**
 * Markdown tables keep their column types across the #2437 lockdown.
 *
 * Before #2437 a captioned markdown table was loaded by writing its cells to
 * a temp CSV and `read_csv_auto`-ing it on the shared connection. The shared
 * connection can't see a temp dir any more, so the typing moved to a private
 * sniffer instance (`csv-sniffer.ts`). These tests replay the OLD load, on an
 * unlocked scratch instance, against the NEW one, and require identical
 * column names, types and values — including the sniffer's quirks a
 * `TRY_CAST` re-implementation would get wrong (yes/no → BOOLEAN, `007` →
 * VARCHAR, `+1` → VARCHAR, a 20-digit integer → DOUBLE).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { DuckDBInstance, type DuckDBConnection } from '@duckdb/node-api';
import { serializeCsv } from '../../../src/shared/csv-parse';
import { createCsvSniffer, type CsvSniffer } from '../../../src/main/sources/csv-sniffer';
import {
  initTablesDb, disposeProject, runQuery, reregisterNoteTables, listTables,
} from '../../../src/main/sources/tables';
import { projectContext } from '../../../src/main/project-context-types';

/** Column → its cells. Chosen to cover every type the sniffer emits, plus its quirks. */
const CORPUS: Record<string, string[]> = {
  ints: ['1', '2', '-3'],
  bits: ['1', '0', '1'],
  bools: ['true', 'false', 'true'],
  yesno: ['yes', 'no', 'yes'],
  floats: ['1.5', '2', '-3.25'],
  sci: ['1e3', '2.5E-2', '3'],
  lead0: ['007', '010', '1'],
  big: ['99999999999999999999', '1', '2'],
  maxint: ['9223372036854775807', '1', '2'],
  pct: ['10%', '20%', '30%'],
  thous: ['1,000', '2,000', '3'],
  isodate: ['2024-01-15', '2024-02-01', '2023-12-31'],
  usdate: ['01/15/2024', '02/01/2024', '12/31/2023'],
  ts: ['2024-01-15 10:00:00', '2024-02-01 11:30:00', '2023-12-31 00:00:00'],
  tstz: ['2024-01-15 10:00:00+02', '2024-02-01 11:30:00Z', '2023-12-31 00:00:00-05'],
  time: ['10:00', '11:30:15', '00:00:00'],
  mixed: ['1', 'abc', '2'],
  empties: ['1', '', '3'],
  allempty: ['', '', ''],
  plus: ['+1', '+2', '3'],
  underscore: ['1_000', '2', '3'],
  quoted: ['a, b', 'say "hi"', 'plain'],
  '': ['x', 'y', 'z'],
  dup: ['p', 'q', 'r'],
};
// A duplicate header and an empty one exercise the sniffer's column renaming.
const HEADERS = [...Object.keys(CORPUS), 'dup'];
const ROWS = [0, 1, 2].map((i) => HEADERS.map((h, c) => (c === HEADERS.length - 1 ? `d${i}` : CORPUS[h]![i]!)));
// A short row: null_padding fills the rest.
ROWS.push(['4']);

interface Shape { names: string[]; types: string[]; rows: unknown[] }

async function shapeOf(conn: DuckDBConnection, table: string): Promise<Shape> {
  const cols = await conn.runAndReadAll(
    `SELECT column_name, data_type FROM information_schema.columns WHERE table_name = '${table}' ORDER BY ordinal_position`,
  );
  const colRows = cols.getRowObjectsJS();
  const data = await conn.runAndReadAll(`SELECT * FROM "${table}"`);
  return {
    names: colRows.map((r) => r.column_name as string),
    types: colRows.map((r) => r.data_type as string),
    rows: data.getRowObjectsJS(),
  };
}

const base = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-sniffer-test-'));
let legacy: { instance: DuckDBInstance; conn: DuckDBConnection };
let target: { instance: DuckDBInstance; conn: DuckDBConnection };
let sniffer: CsvSniffer;

beforeAll(async () => {
  const li = await DuckDBInstance.create(':memory:');
  legacy = { instance: li, conn: await li.connect() };
  const ti = await DuckDBInstance.create(':memory:');
  target = { instance: ti, conn: await ti.connect() };
  // The target is locked down with NO readable directory it could use for a
  // temp file — the new path must not need one.
  fs.mkdirSync(path.join(base, 'empty'));
  await target.conn.run(
    `SET allowed_directories = ['${fs.realpathSync(path.join(base, 'empty'))}/']; ` +
    'SET enable_external_access = false; SET lock_configuration = true;',
  );
  sniffer = await createCsvSniffer();
});

afterAll(async () => {
  await sniffer.close();
  legacy.conn.closeSync(); legacy.instance.closeSync();
  target.conn.closeSync(); target.instance.closeSync();
  fs.rmSync(base, { recursive: true, force: true });
});

/** The pre-#2437 loader, verbatim: temp CSV + read_csv_auto on the target connection. */
async function legacyLoad(tableName: string, csvText: string): Promise<void> {
  const tmp = path.join(base, `${tableName}.csv`);
  fs.writeFileSync(tmp, csvText, 'utf-8');
  await legacy.conn.run(
    `CREATE OR REPLACE TABLE "${tableName}" AS SELECT * FROM ` +
    `read_csv_auto('${tmp.replace(/'/g, "''")}', header=true, null_padding=true)`,
  );
}

describe('csv sniffer parity with the pre-#2437 loader', () => {
  it('produces identical column names, types and values across the corpus', async () => {
    const csv = serializeCsv(HEADERS, ROWS);
    await legacyLoad('corpus', csv);
    await sniffer.loadInto(target.conn, 'corpus', csv);

    const before = await shapeOf(legacy.conn, 'corpus');
    const after = await shapeOf(target.conn, 'corpus');
    expect(after.names).toEqual(before.names);
    expect(after.types).toEqual(before.types);
    expect(after.rows).toEqual(before.rows);

    // Pin the quirks by name, so a parity failure says which rule moved.
    const typeOf = (n: string) => after.types[after.names.indexOf(n)];
    expect(typeOf('ints')).toBe('BIGINT');
    expect(typeOf('yesno')).toBe('BOOLEAN');
    expect(typeOf('lead0')).toBe('VARCHAR');
    expect(typeOf('plus')).toBe('VARCHAR');
    expect(typeOf('big')).toBe('DOUBLE');
    expect(typeOf('isodate')).toBe('DATE');
    expect(typeOf('tstz')).toBe('TIMESTAMP WITH TIME ZONE');
    expect(typeOf('time')).toBe('TIME');
    // BigInt parity too: an integer cell is a JS bigint on both sides.
    expect(typeof (after.rows[0] as Record<string, unknown>).ints).toBe('bigint');
  });

  it('matches on a header-only table and on a single all-text column', async () => {
    for (const [name, headers, rows] of [
      ['header_only', ['a', 'b'], []],
      ['one_col', ['label'], [['x'], ['y']]],
    ] as [string, string[], string[][]][]) {
      const csv = serializeCsv(headers, rows);
      await legacyLoad(name, csv);
      await sniffer.loadInto(target.conn, name, csv);
      expect(await shapeOf(target.conn, name)).toEqual(await shapeOf(legacy.conn, name));
    }
  });

  it('replaces an existing table of the same name', async () => {
    await sniffer.loadInto(target.conn, 'again', serializeCsv(['n'], [['1']]));
    await sniffer.loadInto(target.conn, 'again', serializeCsv(['s'], [['x'], ['y']]));
    const shape = await shapeOf(target.conn, 'again');
    expect(shape.names).toEqual(['s']);
    expect(shape.rows).toHaveLength(2);
  });

  it('leaves no temp file behind, and close() removes its directory', async () => {
    const parent = path.join(base, 'sniff-parent');
    fs.mkdirSync(parent);
    const own = await createCsvSniffer(parent);
    const [dir] = fs.readdirSync(parent);
    expect(dir).toMatch(/^minerva-sniff-/);
    expect(fs.statSync(path.join(parent, dir!)).mode & 0o777).toBe(0o700);
    await own.loadInto(target.conn, 'tidy', serializeCsv(['a'], [['1']]));
    expect(fs.readdirSync(path.join(parent, dir!))).toEqual([]);
    await own.close();
    expect(fs.readdirSync(parent)).toEqual([]);
    await own.close(); // idempotent
  });
});

describe('markdown tables through the locked tables instance (#2437)', () => {
  const root = path.join(base, 'project');
  const ctx = projectContext(root);

  beforeAll(async () => {
    fs.mkdirSync(root);
    await initTablesDb(ctx);
  });
  afterAll(() => disposeProject(ctx));

  it('register with the same types the legacy loader gave them', async () => {
    const headers = ['item', 'qty', 'price', 'when', 'ok'];
    const rows = [['a', '10', '1.5', '2024-01-15', 'true'], ['b', '20', '2', '2024-02-01', 'false']];
    const md = [
      'Table: Orders',
      `| ${headers.join(' | ')} |`,
      `|${headers.map(() => '---').join('|')}|`,
      ...rows.map((r) => `| ${r.join(' | ')} |`),
    ].join('\n');
    const res = await reregisterNoteTables(ctx, 'notes/orders.md', md);
    expect(res.count).toBe(1);

    await legacyLoad('Orders', serializeCsv(headers, rows));
    const legacyShape = await shapeOf(legacy.conn, 'Orders');

    const types = await runQuery(ctx,
      "SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Orders' ORDER BY ordinal_position");
    expect(types.ok).toBe(true);
    if (!types.ok) return;
    expect(types.rows.map((r) => String(r.data_type))).toEqual(legacyShape.types);
    expect(types.rows.map((r) => String(r.column_name))).toEqual(legacyShape.names);

    const sum = await runQuery(ctx, 'SELECT sum(qty) AS n FROM Orders');
    if (sum.ok) expect(sum.rows[0]!.n).toBe(30n);

    const listed = (await listTables(ctx)).find((t) => t.name === 'Orders');
    expect(listed).toMatchObject({ source: 'note', rowCount: 2, columns: headers });
  });
});
