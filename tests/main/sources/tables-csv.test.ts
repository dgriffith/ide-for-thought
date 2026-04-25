import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {
  initTablesDb,
  disposeProject,
  runQuery,
  registerCsv,
  unregisterCsv,
  registerAllCsvs,
  listTables,
  deriveTableName,
} from '../../../src/main/sources/tables';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-tables-csv-test-'));
}

describe('deriveTableName (#233)', () => {
  it('converts slashes and dots to underscores', () => {
    expect(deriveTableName('notes/data/2024-experiment.csv'))
      .toBe('notes_data_2024_experiment');
  });

  it('drops the .csv extension', () => {
    expect(deriveTableName('foo.csv')).toBe('foo');
  });

  it('handles uppercase extensions', () => {
    expect(deriveTableName('Foo.CSV')).toBe('Foo');
  });

  it('prefixes t_ when the name would start with a digit', () => {
    expect(deriveTableName('2024-readings.csv')).toBe('t_2024_readings');
  });

  it('strips non-identifier characters', () => {
    expect(deriveTableName('my (weird) file!.csv')).toBe('my_weird_file');
  });

  it('collapses runs of separators', () => {
    expect(deriveTableName('a///b...c.csv')).toBe('a_b_c');
  });

  it('falls back to `table` for a pathological empty input', () => {
    expect(deriveTableName('.csv')).toBe('table');
  });

  it('preserves underscores and case', () => {
    expect(deriveTableName('My_Data.csv')).toBe('My_Data');
  });
});

describe('CSV pipeline: register / list / unregister (#233)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initTablesDb(ctx);
  });

  afterEach(async () => {
    await disposeProject(ctx);
    await fsp.rm(root, { recursive: true, force: true });
  });

  async function writeCsv(relativePath: string, content: string): Promise<void> {
    const abs = path.join(root, relativePath);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, 'utf-8');
  }

  it('registers a CSV and makes it queryable', async () => {
    await writeCsv('stations.csv', 'id,name,lat\n1,Alpha,0.1\n2,Beta,0.2\n3,Gamma,0.3\n');
    await registerCsv(ctx, 'stations.csv');

    const result = await runQuery(ctx, `SELECT COUNT(*) AS n FROM stations`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows[0]).toEqual({ n: 3n });

    const detail = await runQuery(ctx, `SELECT id, name FROM stations ORDER BY id`);
    expect(detail.ok).toBe(true);
    if (detail.ok) {
      // read_csv_auto infers integer columns as BIGINT, so id values are
      // bigints — faithful reflection of DuckDB's inference, not a bug.
      expect(detail.rows).toEqual([
        { id: 1n, name: 'Alpha' },
        { id: 2n, name: 'Beta' },
        { id: 3n, name: 'Gamma' },
      ]);
    }
  });

  it('derives nested table names from the relative path', async () => {
    await writeCsv('data/2024-experiment.csv', 'x,y\n1,2\n3,4\n');
    await registerCsv(ctx, 'data/2024-experiment.csv');

    const result = await runQuery(ctx, `SELECT SUM(x) AS s FROM data_2024_experiment`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows[0]).toEqual({ s: 4n });
  });

  it('honours a companion .md `table_name:` override', async () => {
    await writeCsv('data/2024-experiment.csv', 'x,y\n1,2\n');
    await fsp.mkdir(path.join(root, 'data'), { recursive: true });
    await fsp.writeFile(
      path.join(root, 'data', '2024-experiment.md'),
      '---\ntitle: 2024 readings\ntable_name: experiment_2024\n---\n\n# Notes about the 2024 batch\n',
      'utf-8',
    );
    await registerCsv(ctx, 'data/2024-experiment.csv');

    const hit = await runQuery(ctx, `SELECT * FROM experiment_2024`);
    expect(hit.ok).toBe(true);
    if (hit.ok) expect(hit.rows).toEqual([{ x: 1n, y: 2n }]);

    // The derived name should NOT also exist.
    const derived = await runQuery(ctx, `SELECT * FROM data_2024_experiment`);
    expect(derived.ok).toBe(false);
  });

  it('unregisterCsv drops the view', async () => {
    await writeCsv('scratch.csv', 'a\n1\n');
    await registerCsv(ctx, 'scratch.csv');
    expect((await runQuery(ctx, `SELECT * FROM scratch`)).ok).toBe(true);

    await unregisterCsv(ctx, 'scratch.csv');
    const gone = await runQuery(ctx, `SELECT * FROM scratch`);
    expect(gone.ok).toBe(false);
  });

  it('listTables returns registered CSVs with row/column counts', async () => {
    await writeCsv('a.csv', 'x,y\n1,2\n3,4\n');
    await writeCsv('nested/b.csv', 'p,q,r\n1,2,3\n');
    await registerCsv(ctx, 'a.csv');
    await registerCsv(ctx, 'nested/b.csv');

    const tables = await listTables(ctx);
    expect(tables).toHaveLength(2);

    const a = tables.find((t) => t.name === 'a');
    const b = tables.find((t) => t.name === 'nested_b');
    expect(a).toEqual({ name: 'a', relativePath: 'a.csv', columns: ['x', 'y'], rowCount: 2 });
    expect(b).toEqual({ name: 'nested_b', relativePath: 'nested/b.csv', columns: ['p', 'q', 'r'], rowCount: 1 });
  });

  it('registerAllCsvs picks up existing CSVs on project open', async () => {
    await writeCsv('top.csv', 'n\n1\n2\n');
    await writeCsv('sub/mid.csv', 'm\nx\n');
    await writeCsv('sub/deep/bottom.csv', 'k\na\nb\nc\n');
    // Hidden dir — should be skipped.
    await writeCsv('.minerva/secret.csv', 'x\n1\n');

    const count = await registerAllCsvs(ctx);
    expect(count).toBe(3);

    const tables = await listTables(ctx);
    expect(tables.map((t) => t.name).sort()).toEqual(['sub_deep_bottom', 'sub_mid', 'top']);
  });

  it('re-registering after a table_name override swaps the view name', async () => {
    await writeCsv('readings.csv', 'x\n1\n');
    await registerCsv(ctx, 'readings.csv');
    expect((await runQuery(ctx, `SELECT * FROM readings`)).ok).toBe(true);

    // Now add a companion note with an override and re-register.
    await fsp.writeFile(
      path.join(root, 'readings.md'),
      '---\ntable_name: measurements\n---\n',
      'utf-8',
    );
    await registerCsv(ctx, 'readings.csv');

    expect((await runQuery(ctx, `SELECT * FROM measurements`)).ok).toBe(true);
    expect((await runQuery(ctx, `SELECT * FROM readings`)).ok).toBe(false);
  });
});
