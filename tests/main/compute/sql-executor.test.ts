import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  initTablesDb,
  disposeProject,
  registerCsv,
} from '../../../src/main/sources/tables';
import { executeSql } from '../../../src/main/compute/executors/sql';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

describe('executeSql (#240)', () => {
  let root: string;
  let ctx: ProjectContext;
  let CTX: { rootPath: string };

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-sql-exec-test-'));
    ctx = projectContext(root);
    CTX = { rootPath: root };
    await initTablesDb(ctx);
    await fsp.writeFile(
      path.join(root, 'data.csv'),
      'name,count\nalpha,1\nbeta,2\ngamma,3\n',
    );
    await registerCsv(ctx, 'data.csv');
  });

  afterAll(async () => {
    disposeProject(ctx);
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('returns a typed table output with columns + row arrays', async () => {
    const result = await executeSql('SELECT name, count FROM data ORDER BY name', CTX);
    expect(result.ok).toBe(true);
    if (!result.ok || result.output.type !== 'table') return;
    expect(result.output.columns).toEqual(['name', 'count']);
    // DuckDB returns INTEGER as BigInt; normalizeCell keeps in-range integers
    // numeric so the column reads as numbers (and `minerva.sql()` hands pandas
    // an int64 column) rather than text.
    expect(result.output.rows).toEqual([
      ['alpha', 1],
      ['beta', 2],
      ['gamma', 3],
    ]);
  });

  it('keeps large BigInts as decimal strings to avoid precision loss', async () => {
    // 2^63 - 1 exceeds Number.MAX_SAFE_INTEGER, so it must survive as a string
    // rather than a lossy Number.
    const result = await executeSql('SELECT 9223372036854775807::BIGINT AS big', CTX);
    expect(result.ok).toBe(true);
    if (!result.ok || result.output.type !== 'table') return;
    expect(result.output.rows).toEqual([['9223372036854775807']]);
  });

  it('keeps in-range BigInts numeric', async () => {
    const result = await executeSql('SELECT 42::BIGINT AS n', CTX);
    expect(result.ok).toBe(true);
    if (!result.ok || result.output.type !== 'table') return;
    expect(result.output.rows).toEqual([[42]]);
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
