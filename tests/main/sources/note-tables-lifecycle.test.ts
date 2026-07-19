import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  initTablesDb,
  disposeProject,
  runQuery,
  registerAllCsvs,
  registerAllNoteTables,
  listTables,
  onCsvTableCollision,
} from '../../../src/main/sources/tables';
import { projectContext } from '../../../src/main/project-context-types';

let rootPath: string;
let ctx: ReturnType<typeof projectContext>;

beforeEach(async () => {
  rootPath = await fs.mkdtemp(path.join(os.tmpdir(), 'minerva-note-lifecycle-'));
  ctx = projectContext(rootPath);
  await initTablesDb(ctx);
});

afterEach(async () => {
  disposeProject(ctx);
  await fs.rm(rootPath, { recursive: true, force: true });
});

async function write(rel: string, content: string): Promise<void> {
  const abs = path.join(rootPath, rel);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  await fs.writeFile(abs, content, 'utf-8');
}

describe('registerAllNoteTables (#1358)', () => {
  it('registers captioned tables from notes across subdirectories', async () => {
    await write('top.md', 'Table: budget\n| item | cost |\n|------|------|\n| pens | 3 |\n| ink | 7 |');
    await write('sub/nested.md', 'Table: crew\n| who | age |\n|-----|-----|\n| ana | 30 |');
    await write('plain.md', '| a | b |\n|---|---|\n| 1 | 2 |'); // uncaptioned → skipped

    const out = await registerAllNoteTables(ctx);
    expect(out.count).toBe(2);

    const budget = await runQuery(ctx, 'SELECT sum(cost) AS total FROM budget');
    if (budget.ok) expect(Number(budget.rows[0]!.total)).toBe(10);
    expect((await runQuery(ctx, 'SELECT * FROM crew')).ok).toBe(true);
  });

  it('lets a CSV win a name shared with a note table (CSV registered first)', async () => {
    await write('sales.csv', 'x,y\n1,2\n');
    await write('note.md', 'Table: sales\n| a | b |\n|---|---|\n| 9 | 9 |');

    await registerAllCsvs(ctx);
    const collisions: unknown[] = [];
    const unsub = onCsvTableCollision(rootPath, (c) => collisions.push(c));
    const out = await registerAllNoteTables(ctx);
    unsub();

    expect(out.collisions).toHaveLength(1);
    expect(collisions).toHaveLength(1);
    // `sales` still resolves to the CSV's columns, not the note's.
    const cols = await runQuery(ctx, "SELECT column_name FROM information_schema.columns WHERE table_name = 'sales' ORDER BY ordinal_position");
    if (cols.ok) expect(cols.rows.map((r) => r.column_name)).toEqual(['x', 'y']);
  });

  it('listTables labels tables by source (csv file vs note) with caption + index', async () => {
    await write('data.csv', 'x,y\n1,2\n');
    await write('report.md', 'Table: findings\n| metric | value |\n|--------|-------|\n| n | 5 |');
    await registerAllCsvs(ctx);
    await registerAllNoteTables(ctx);

    const tables = await listTables(ctx);
    const csv = tables.find((t) => t.name === 'data');
    const note = tables.find((t) => t.name === 'findings');

    expect(csv?.source).toBe('csv');
    expect(csv?.caption).toBeUndefined();

    expect(note?.source).toBe('note');
    expect(note?.relativePath).toBe('report.md');
    expect(note?.caption).toBe('findings');
    expect(note?.tableIndex).toBe(0);
    expect(note?.columns).toEqual(['metric', 'value']);
  });

  it('drops a note table on a subsequent sweep after the note is deleted', async () => {
    await write('temp.md', 'Table: ephemeral\n| a | b |\n|---|---|\n| 1 | 2 |');
    await registerAllNoteTables(ctx);
    expect((await runQuery(ctx, 'SELECT * FROM ephemeral')).ok).toBe(true);

    await fs.rm(path.join(rootPath, 'temp.md'));
    await registerAllNoteTables(ctx);
    expect((await runQuery(ctx, 'SELECT * FROM ephemeral')).ok).toBe(false);
  });
});
