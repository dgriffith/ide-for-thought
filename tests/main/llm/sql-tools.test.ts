import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { executeNotebaseTool } from '../../../src/main/llm/tools';
import { initTablesDb, registerCsv, disposeProject } from '../../../src/main/sources/tables';
import { projectContext } from '../../../src/main/project-context-types';
import { useTempDir } from '../../helpers/temp-project';

describe('LLM SQL tools — describe_tables (#780) + query_sql (#781)', () => {
  const project = useTempDir('minerva-sql-tools-test-');

  beforeEach(async () => {
    await initTablesDb(projectContext(project.root));
  });

  afterEach(async () => {
    disposeProject(projectContext(project.root));
  });

  async function writeCsv(rel: string, content: string): Promise<void> {
    const abs = path.join(project.root, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, 'utf-8');
    await registerCsv(projectContext(project.root), rel);
  }

  it('describe_tables lists a registered table with its columns', async () => {
    await writeCsv('stations.csv', 'id,name,lat\n1,Alpha,0.1\n2,Beta,0.2\n');
    const res = await executeNotebaseTool({ rootPath: project.root }, 'describe_tables', {});
    expect(res.isError).toBe(false);
    expect(res.content).toContain('stations');
    expect(res.content).toContain('id, name, lat');
    expect(res.content).toContain('2 rows');
  });

  it('describe_tables reports a clear empty state', async () => {
    const res = await executeNotebaseTool({ rootPath: project.root }, 'describe_tables', {});
    expect(res.isError).toBe(false);
    expect(res.content).toMatch(/no csv tables/i);
  });

  it('query_sql returns rows for a SELECT', async () => {
    await writeCsv('stations.csv', 'id,name\n1,Alpha\n2,Beta\n');
    const res = await executeNotebaseTool({ rootPath: project.root }, 'query_sql', {
      sql: 'SELECT name FROM stations ORDER BY id',
    });
    expect(res.isError).toBe(false);
    const rows = JSON.parse(res.content) as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Beta']);
  });

  it('query_sql serializes integer columns without a BigInt crash (regression)', async () => {
    // DuckDB returns BIGINT columns as JS bigint; plain JSON.stringify throws
    // "Do not know how to serialize a BigInt". The Find Correlations / Find
    // Outliers skills hit this on their first real query.
    await writeCsv('stations.csv', 'id,name\n1,Alpha\n2,Beta\n');
    const res = await executeNotebaseTool({ rootPath: project.root }, 'query_sql', {
      sql: 'SELECT id, name FROM stations ORDER BY id',
    });
    expect(res.isError).toBe(false);
    const rows = JSON.parse(res.content) as Array<{ id: number; name: string }>;
    expect(rows).toEqual([{ id: 1, name: 'Alpha' }, { id: 2, name: 'Beta' }]);
  });

  it('query_sql handles SUMMARIZE (all-BigInt count columns) — the reported failure', async () => {
    await writeCsv('mandolin_models.csv', 'id,price\n1,1200\n2,3400\n3,900\n');
    const res = await executeNotebaseTool({ rootPath: project.root }, 'query_sql', {
      sql: 'SUMMARIZE "mandolin_models"',
    });
    expect(res.isError).toBe(false);
    // Parses (no BigInt throw) and carries the profiling columns SUMMARIZE emits.
    const rows = JSON.parse(res.content) as Array<Record<string, unknown>>;
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.some((r) => r.column_name === 'price')).toBe(true);
  });

  it('query_sql rejects non-read-only statements', async () => {
    await writeCsv('stations.csv', 'id,name\n1,Alpha\n');
    for (const sql of ['DELETE FROM stations', 'CREATE TABLE x (a int)', 'DROP TABLE stations']) {
      const res = await executeNotebaseTool({ rootPath: project.root }, 'query_sql', { sql });
      expect(res.isError).toBe(true);
      expect(res.content).toMatch(/read-only/i);
    }
  });

  it('query_sql rejects multiple statements', async () => {
    await writeCsv('stations.csv', 'id\n1\n');
    const res = await executeNotebaseTool({ rootPath: project.root }, 'query_sql', {
      sql: 'SELECT * FROM stations; DROP TABLE stations',
    });
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/one statement/i);
  });

  it('query_sql error points at describe_tables', async () => {
    const res = await executeNotebaseTool({ rootPath: project.root }, 'query_sql', {
      sql: 'SELECT * FROM does_not_exist',
    });
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/describe_tables/);
  });
});
