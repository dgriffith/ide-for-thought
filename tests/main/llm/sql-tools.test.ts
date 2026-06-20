import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { executeNotebaseTool } from '../../../src/main/llm/tools';
import { initTablesDb, registerCsv, disposeProject } from '../../../src/main/sources/tables';
import { projectContext } from '../../../src/main/project-context-types';

function mkTempProject(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-sql-tools-test-'));
}

describe('LLM SQL tools — describe_tables (#780) + query_sql (#781)', () => {
  let root: string;

  beforeEach(async () => {
    root = mkTempProject();
    await initTablesDb(projectContext(root));
  });

  afterEach(async () => {
    disposeProject(projectContext(root));
    await fsp.rm(root, { recursive: true, force: true });
  });

  async function writeCsv(rel: string, content: string): Promise<void> {
    const abs = path.join(root, rel);
    await fsp.mkdir(path.dirname(abs), { recursive: true });
    await fsp.writeFile(abs, content, 'utf-8');
    await registerCsv(projectContext(root), rel);
  }

  it('describe_tables lists a registered table with its columns', async () => {
    await writeCsv('stations.csv', 'id,name,lat\n1,Alpha,0.1\n2,Beta,0.2\n');
    const res = await executeNotebaseTool({ rootPath: root }, 'describe_tables', {});
    expect(res.isError).toBe(false);
    expect(res.content).toContain('stations');
    expect(res.content).toContain('id, name, lat');
    expect(res.content).toContain('2 rows');
  });

  it('describe_tables reports a clear empty state', async () => {
    const res = await executeNotebaseTool({ rootPath: root }, 'describe_tables', {});
    expect(res.isError).toBe(false);
    expect(res.content).toMatch(/no csv tables/i);
  });

  it('query_sql returns rows for a SELECT', async () => {
    await writeCsv('stations.csv', 'id,name\n1,Alpha\n2,Beta\n');
    const res = await executeNotebaseTool({ rootPath: root }, 'query_sql', {
      sql: 'SELECT name FROM stations ORDER BY id',
    });
    expect(res.isError).toBe(false);
    const rows = JSON.parse(res.content) as Array<{ name: string }>;
    expect(rows.map((r) => r.name)).toEqual(['Alpha', 'Beta']);
  });

  it('query_sql rejects non-read-only statements', async () => {
    await writeCsv('stations.csv', 'id,name\n1,Alpha\n');
    for (const sql of ['DELETE FROM stations', 'CREATE TABLE x (a int)', 'DROP TABLE stations']) {
      const res = await executeNotebaseTool({ rootPath: root }, 'query_sql', { sql });
      expect(res.isError).toBe(true);
      expect(res.content).toMatch(/read-only/i);
    }
  });

  it('query_sql rejects multiple statements', async () => {
    await writeCsv('stations.csv', 'id\n1\n');
    const res = await executeNotebaseTool({ rootPath: root }, 'query_sql', {
      sql: 'SELECT * FROM stations; DROP TABLE stations',
    });
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/one statement/i);
  });

  it('query_sql error points at describe_tables', async () => {
    const res = await executeNotebaseTool({ rootPath: root }, 'query_sql', {
      sql: 'SELECT * FROM does_not_exist',
    });
    expect(res.isError).toBe(true);
    expect(res.content).toMatch(/describe_tables/);
  });
});
