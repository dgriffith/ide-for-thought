import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  initTablesDb,
  closeTablesDb,
  registerCsv,
} from '../../../src/main/sources/tables';
import { executeSql } from '../../../src/main/compute/executors/sql';

const CTX = { rootPath: '/tmp/minerva-sql-exec-test' };

describe('executeSql (#240)', () => {
  let root: string;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-sql-exec-test-'));
    await initTablesDb(root);
    await fsp.writeFile(
      path.join(root, 'data.csv'),
      'name,count\nalpha,1\nbeta,2\ngamma,3\n',
    );
    await registerCsv(root, 'data.csv');
  });

  afterAll(async () => {
    await closeTablesDb();
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('returns a typed table output with columns + row arrays', async () => {
    const result = await executeSql('SELECT name, count FROM data ORDER BY name', CTX);
    expect(result.ok).toBe(true);
    if (!result.ok || result.output.type !== 'table') return;
    expect(result.output.columns).toEqual(['name', 'count']);
    // DuckDB returns INTEGER as BigInt; normalizeCell stringifies bigints so
    // the preview can render them without JSON reviver hoops.
    expect(result.output.rows).toEqual([
      ['alpha', '1'],
      ['beta', '2'],
      ['gamma', '3'],
    ]);
  });

  it('surfaces SQL syntax errors as ok:false rather than throwing', async () => {
    const result = await executeSql('SELEKT * FROM data', CTX);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.length).toBeGreaterThan(0);
  });

  it('normalises nulls into JSON null rather than empty strings', async () => {
    const result = await executeSql(`SELECT NULL AS x, 'hi' AS y`, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok || result.output.type !== 'table') return;
    expect(result.output.rows).toEqual([[null, 'hi']]);
  });

  it('normalises DuckDB Date values to ISO strings', async () => {
    const result = await executeSql(`SELECT DATE '2024-10-15' AS d`, CTX);
    expect(result.ok).toBe(true);
    if (!result.ok || result.output.type !== 'table') return;
    const cell = result.output.rows[0][0];
    // DuckDB + the Node client may surface dates as Date objects OR as
    // ISO-ish strings depending on type binding — accept either but
    // require the row dropped us a parseable date-shaped string.
    expect(typeof cell === 'string' ? cell : '').toMatch(/^\d{4}-\d{2}-\d{2}/);
  });
});
