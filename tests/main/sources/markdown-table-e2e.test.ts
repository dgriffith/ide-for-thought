/**
 * End-to-end parity for captioned markdown tables ↔ CSV SQL tables (epic #1355,
 * ticket #1361). Drives the full create → query → edit → delete flow through the
 * same entry points the app uses:
 *  - `reregisterNoteTables` is what the file watcher + boot sweep call on save.
 *  - `runQuery` is the single connection behind the Query panel, ```sql compute
 *    cells, the `query-sql` LLM tool, Vega, and the CLI — so exercising it here
 *    proves every one of those surfaces sees note tables.
 *  - `queryGraph` proves the #1360 graph overlay lands alongside the SQL table.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs/promises';
import path from 'node:path';
import {
  initTablesDb,
  disposeProject,
  runQuery,
  registerCsv,
  registerAllNoteTables,
  reregisterNoteTables,
  unregisterNoteTables,
  listTables,
  onCsvTableCollision,
} from '../../../src/main/sources/tables';
import { queryGraph } from '../../../src/main/graph/index';
import { makeGraphProject, type GraphProject } from '../../helpers/temp-project';

let project: GraphProject;
let ctx: GraphProject['ctx'];
let root: string;

beforeEach(async () => {
  project = await makeGraphProject('minerva-mdtable-e2e-');
  ctx = project.ctx;
  root = project.root;
  await initTablesDb(ctx);
});

afterEach(async () => {
  disposeProject(ctx);
  await project.cleanup();
});

const SALES_NOTE = [
  'Table: sales',
  '| item | amount |',
  '| ---- | ------ |',
  '| pens | 3 |',
  '| ink  | 7 |',
].join('\n');

describe('markdown-table SQL parity — end to end (#1361)', () => {
  it('create → query: a captioned table is SELECT-able with inferred numeric types', async () => {
    const r = await reregisterNoteTables(ctx, 'notes/q3.md', SALES_NOTE);
    expect(r.count).toBe(1);

    // The query path (shared by compute cells, query-sql tool, Vega, CLI).
    const sum = await runQuery(ctx, 'SELECT sum(amount) AS total FROM sales');
    expect(sum.ok).toBe(true);
    if (sum.ok) expect(Number(sum.rows[0]!.total)).toBe(10);

    // It shows up in the panel listing, tagged as a note.
    const tables = await listTables(ctx);
    expect(tables.find((t) => t.name === 'sales')?.source).toBe('note');

    // And the #1360 graph overlay is joined back to the note.
    const g = await queryGraph(ctx, `SELECT ?note WHERE { ?t minerva:tableName "sales" ; minerva:fromNote ?note }`);
    expect((g.results as Array<{ note: string }>)[0]!.note).toContain('notes/q3');
  });

  it('edit → query reflects new rows', async () => {
    await reregisterNoteTables(ctx, 'notes/q3.md', SALES_NOTE);
    const edited = SALES_NOTE.replace('| ink  | 7 |', '| ink  | 7 |\n| tape | 90 |');
    await reregisterNoteTables(ctx, 'notes/q3.md', edited);

    const sum = await runQuery(ctx, 'SELECT sum(amount) AS total FROM sales');
    if (sum.ok) expect(Number(sum.rows[0]!.total)).toBe(100);
  });

  it('delete → query fails and the graph overlay is gone', async () => {
    await reregisterNoteTables(ctx, 'notes/q3.md', SALES_NOTE);
    await unregisterNoteTables(ctx, 'notes/q3.md');

    expect((await runQuery(ctx, 'SELECT * FROM sales')).ok).toBe(false);
    const g = await queryGraph(ctx, `SELECT ?t WHERE { ?t minerva:tableName "sales" }`);
    expect(g.results).toHaveLength(0);
  });

  it('collision: a CSV named sales wins over a note Table: sales (deterministic + toast)', async () => {
    await fs.writeFile(path.join(root, 'sales.csv'), 'region,revenue\nNW,100\n', 'utf-8');
    await registerCsv(ctx, 'sales.csv');
    await fs.mkdir(path.join(root, 'notes'), { recursive: true });
    await fs.writeFile(path.join(root, 'notes/q3.md'), SALES_NOTE, 'utf-8');

    const collisions: unknown[] = [];
    const unsub = onCsvTableCollision(root, (c) => collisions.push(c));
    const out = await registerAllNoteTables(ctx); // sweep runs after CSVs, mirroring boot
    unsub();

    expect(out.collisions).toHaveLength(1);
    expect(collisions).toHaveLength(1);
    // `sales` still resolves to the CSV, not the note.
    const cols = await runQuery(ctx, "SELECT column_name FROM information_schema.columns WHERE table_name = 'sales' ORDER BY ordinal_position");
    if (cols.ok) expect(cols.rows.map((r) => r.column_name)).toEqual(['region', 'revenue']);
  });
});
