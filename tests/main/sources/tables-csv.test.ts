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
  onCsvTableCollision,
  type CsvTableCollision,
} from '../../../src/main/sources/tables';
import { initGraph, indexAllNotes, queryGraph } from '../../../src/main/graph/index';
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
    disposeProject(ctx);
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

  it('honours an explicit schema declared in the companion .md `csv:` block (#237)', async () => {
    await writeCsv('events.csv', 'submitted_at,category,score\n2024-01-02,alpha,3.14\n');
    await fsp.writeFile(
      path.join(root, 'events.md'),
      [
        '---',
        'csv:',
        '  columns:',
        '    submitted_at: DATE',
        '    category: VARCHAR',
        '    score: DOUBLE',
        '---',
        '# Events',
      ].join('\n'),
      'utf-8',
    );
    await registerCsv(ctx, 'events.csv');

    const describe = await runQuery(ctx, `DESCRIBE events`);
    expect(describe.ok).toBe(true);
    if (describe.ok) {
      const types = Object.fromEntries(
        describe.rows.map((r) => [String(r.column_name), String(r.column_type)]),
      );
      expect(types.submitted_at).toBe('DATE');
      expect(types.category).toBe('VARCHAR');
      expect(types.score).toBe('DOUBLE');
    }
  });

  it('falls back to a sidecar `<stem>.csv.schema.yaml` when no companion .md is present (#237)', async () => {
    await writeCsv('events.csv', 'submitted_at,category,score\n2024-01-02,alpha,3.14\n');
    await fsp.writeFile(
      path.join(root, 'events.csv.schema.yaml'),
      [
        'columns:',
        '  submitted_at: DATE',
        '  category: VARCHAR',
        '  score: DOUBLE',
      ].join('\n'),
      'utf-8',
    );
    await registerCsv(ctx, 'events.csv');

    const describe = await runQuery(ctx, `DESCRIBE events`);
    expect(describe.ok).toBe(true);
    if (describe.ok) {
      const types = Object.fromEntries(
        describe.rows.map((r) => [String(r.column_name), String(r.column_type)]),
      );
      expect(types.submitted_at).toBe('DATE');
      expect(types.category).toBe('VARCHAR');
      expect(types.score).toBe('DOUBLE');
    }
  });

  it('respects header: false from the schema (#237)', async () => {
    await writeCsv('rows.csv', '1,alpha\n2,beta\n');
    await fsp.writeFile(
      path.join(root, 'rows.csv.schema.yaml'),
      [
        'columns:',
        '  id: INTEGER',
        '  name: VARCHAR',
        'header: false',
      ].join('\n'),
      'utf-8',
    );
    await registerCsv(ctx, 'rows.csv');

    const result = await runQuery(ctx, `SELECT * FROM rows ORDER BY id`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // header: false means BOTH lines are data — auto would have
      // consumed the first as a header.
      expect(result.rows).toEqual([
        { id: 1, name: 'alpha' },
        { id: 2, name: 'beta' },
      ]);
    }
  });

  it('schema-less CSVs still load via auto-inference (#237 no-regression)', async () => {
    await writeCsv('plain.csv', 'a,b\n1,2\n3,4\n');
    await registerCsv(ctx, 'plain.csv');

    const result = await runQuery(ctx, `SELECT a, b FROM plain ORDER BY a`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // BIGINT inference is the existing auto-detect behavior; the
      // schema branch didn't accidentally route schema-less CSVs
      // through read_csv with empty types.
      expect(result.rows).toEqual([{ a: 1n, b: 2n }, { a: 3n, b: 4n }]);
    }
  });

  it('re-registers under a new schema when the sidecar is rewritten (#237)', async () => {
    await writeCsv('events.csv', 'submitted_at,category\n2024-01-02,alpha\n');
    // First: VARCHAR types
    await fsp.writeFile(
      path.join(root, 'events.csv.schema.yaml'),
      'columns:\n  submitted_at: VARCHAR\n  category: VARCHAR\n',
      'utf-8',
    );
    await registerCsv(ctx, 'events.csv');
    let describe = await runQuery(ctx, `DESCRIBE events`);
    if (describe.ok) {
      const types = Object.fromEntries(
        describe.rows.map((r) => [String(r.column_name), String(r.column_type)]),
      );
      expect(types.submitted_at).toBe('VARCHAR');
    }

    // Rewrite the sidecar to DATE for submitted_at, re-register.
    await fsp.writeFile(
      path.join(root, 'events.csv.schema.yaml'),
      'columns:\n  submitted_at: DATE\n  category: VARCHAR\n',
      'utf-8',
    );
    await registerCsv(ctx, 'events.csv');
    describe = await runQuery(ctx, `DESCRIBE events`);
    if (describe.ok) {
      const types = Object.fromEntries(
        describe.rows.map((r) => [String(r.column_name), String(r.column_type)]),
      );
      expect(types.submitted_at).toBe('DATE');
    }
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

  it('returns a structured collision result when two CSVs derive the same table name (#354)', async () => {
    // `foo/bar.csv` and `foo_bar.csv` both slug to `foo_bar`.
    await writeCsv('foo/bar.csv', 'n\n1\n');
    await writeCsv('foo_bar.csv', 'n\n2\n');
    const first = await registerCsv(ctx, 'foo/bar.csv');
    expect(first.ok).toBe(true);
    const second = await registerCsv(ctx, 'foo_bar.csv');
    expect(second.ok).toBe(false);
    if (!second.ok) {
      expect(second.reason).toBe('collision');
      if (second.reason === 'collision') {
        expect(second.collision.existingPath).toBe('foo/bar.csv');
        expect(second.collision.attemptedPath).toBe('foo_bar.csv');
        expect(second.collision.tableName).toBe('foo_bar');
      }
    }
  });

  it('fires onCsvTableCollision listeners with the project rootPath (#354)', async () => {
    const seen: CsvTableCollision[] = [];
    const off = onCsvTableCollision(root, (c) => { seen.push(c); });
    await writeCsv('foo/bar.csv', 'n\n1\n');
    await writeCsv('foo_bar.csv', 'n\n2\n');
    await registerCsv(ctx, 'foo/bar.csv');
    await registerCsv(ctx, 'foo_bar.csv');
    off();
    expect(seen).toHaveLength(1);
    expect(seen[0]).toMatchObject({ existingPath: 'foo/bar.csv', attemptedPath: 'foo_bar.csv' });
  });

  it('aggregates collisions in registerAllCsvs return value (#354)', async () => {
    await writeCsv('foo/bar.csv', 'n\n1\n');
    await writeCsv('foo_bar.csv', 'n\n2\n');
    await writeCsv('clean.csv', 'n\n3\n');
    const { count, collisions } = await registerAllCsvs(ctx);
    // Two distinct table names landed (foo_bar from one of them, clean).
    expect(count).toBe(2);
    expect(collisions).toHaveLength(1);
    expect(collisions[0].tableName).toBe('foo_bar');
  });

  it('registerAllCsvs picks up existing CSVs on project open', async () => {
    await writeCsv('top.csv', 'n\n1\n2\n');
    await writeCsv('sub/mid.csv', 'm\nx\n');
    await writeCsv('sub/deep/bottom.csv', 'k\na\nb\nc\n');
    // Hidden dir — should be skipped.
    await writeCsv('.minerva/secret.csv', 'x\n1\n');

    const { count, collisions } = await registerAllCsvs(ctx);
    expect(count).toBe(3);
    expect(collisions).toEqual([]);

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

describe('CSV graph views coexist after indexAllNotes resets the store (#337 race fix)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = mkTempProject();
    ctx = projectContext(root);
    await initGraph(ctx);
    await initTablesDb(ctx);
  });
  afterEach(async () => {
    disposeProject(ctx);
    await fsp.rm(root, { recursive: true, force: true });
  });

  it('keeps both the file-level csvw:Table and the SQL table schema (minerva:fromFile)', async () => {
    // indexAllNotes does `state.store = $rdf.graph()` — a full reset — then
    // rebuilds. registerAllCsvs writes the CSV schema overlay (indexCsvTable) to
    // that same store. The init path now sequences them so the overlay can never
    // land in the discarded store; this pins that both graph views survive.
    await fsp.writeFile(path.join(root, 'stations.csv'), 'id,name\n1,Alpha\n2,Beta\n', 'utf-8');

    await indexAllNotes(ctx);   // resets + rebuilds the store; indexes the file-level view
    await registerAllCsvs(ctx); // writes the SQL table schema + minerva:fromFile

    // File-level view (indexCsvFile): the file IS a csvw:Table with columns.
    const fileView = await queryGraph(ctx, `
      SELECT ?col WHERE {
        ?t minerva:relativePath "stations.csv" ; a csvw:Table ; csvw:column ?c .
        ?c csvw:name ?col .
      } ORDER BY ?col
    `);
    expect((fileView.results as Array<{ col: string }>).map((r) => r.col)).toEqual(['id', 'name']);

    // SQL view (indexCsvTable): a typed table linked back to the file. This is
    // exactly the triple set the race would have orphaned.
    const sqlView = await queryGraph(ctx, `
      SELECT ?col WHERE {
        ?table minerva:fromFile ?file .
        ?file minerva:relativePath "stations.csv" .
        ?table csvw:tableSchema ?schema .
        ?schema csvw:column ?c .
        ?c csvw:name ?col .
      } ORDER BY ?col
    `);
    expect((sqlView.results as Array<{ col: string }>).map((r) => r.col)).toEqual(['id', 'name']);
  });
});
