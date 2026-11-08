/**
 * A query view's rows (#2944), against a real indexed thoughtbase: SPARQL
 * with a note column, with none, with two candidates; titles and tags from
 * the note; a projected `title`; SQL over a registered CSV, through the note
 * guard (which refuses a read of `.minerva/`); the row cap; inferred column
 * types and overrides; a malformed query as `{ ok: false }`.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { indexAllNotes } from '../../../src/main/graph/index';
import { initTablesDb, disposeProject, registerCsv } from '../../../src/main/sources/tables';
import { queryViewRows } from '../../../src/main/views/query-rows';
import { QUERY_VIEW_ROW_LIMIT } from '../../../src/shared/views/query-view';
import { useGraphProject } from '../../helpers/temp-project';
import { silenceLogTags } from '../../helpers/quiet-logs';

silenceLogTags('graph', 'tables');

const project = useGraphProject('minerva-query-rows-');
const write = (rel: string, text: string) => {
  fs.mkdirSync(path.dirname(path.join(project.root, rel)), { recursive: true });
  fs.writeFileSync(path.join(project.root, rel), text);
};

beforeEach(async () => {
  write('tasks/Paint shed.md', '---\ntitle: Paint the shed\nstatus: todo\ndue: 2026-10-07\ntags: [garden]\n---\n# Paint the shed\n\nWith [[Ann]].\n');
  write('tasks/Fix gate.md', '---\nstatus: done\ndue: 2026-10-09\n---\n# Fix gate\n\nAsk [[Ann]].\n');
  write('tasks/Mow.md', '---\nstatus: todo\ndue: 2026-11-01\n---\n# Mow\n');
  write('Ann.md', '# Ann\n');
  await indexAllNotes(project.ctx);
});

const STATUS = `SELECT ?n ?status ?due WHERE {
  ?n minerva:relativePath ?p ; minerva:meta-status ?status ; minerva:meta-due ?due .
} ORDER BY ?p`;

describe('SPARQL (#2944)', () => {
  it('the note column is found, rows carry their note, its title and tags, and columns are typed', async () => {
    const r = await queryViewRows(project.ctx, STATUS, 'sparql');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.schema.noteColumn).toBe('n');
    expect(r.schema.columns).toEqual([
      { name: 'status', type: 'enum', options: ['done', 'todo'] },
      { name: 'due', type: 'date' },
    ]);
    expect(r.rows.map((x) => x.path)).toEqual(['tasks/Fix gate.md', 'tasks/Mow.md', 'tasks/Paint shed.md']);
    expect(r.rows[2]).toMatchObject({ title: 'Paint the shed', values: { status: 'todo', due: '2026-10-07' }, tags: ['garden'] });
    expect(r.rows[1]!.title).toBe('Mow');
    expect(r.rows[1]).not.toHaveProperty('tags');
    expect(r.truncated).toBe(false);
  });

  it('a projected title wins; with no column naming a note, rows have no note', async () => {
    const r = await queryViewRows(project.ctx, `SELECT ?title ?status WHERE { ?n minerva:meta-status ?status ; minerva:relativePath ?title }`, 'sparql');
    expect(r.ok && r.schema.noteColumn).toBe('title'); // the paths themselves name notes
    const none = await queryViewRows(project.ctx, `SELECT ?status (COUNT(?n) AS ?count) WHERE { ?n minerva:meta-status ?status } GROUP BY ?status ORDER BY ?status`, 'sparql');
    if (!none.ok) throw new Error(none.error);
    expect(none.schema.noteColumn).toBeNull();
    expect(none.rows).toEqual([
      { path: null, title: 'done', values: { status: 'done', count: '1' } },
      { path: null, title: 'todo', values: { status: 'todo', count: '2' } },
    ]);
    expect(none.schema.columns.find((c) => c.name === 'count')?.type).toBe('number');
  });

  it('with two note columns, the first is the row\'s note and the other is a link to a note; `note` picks', async () => {
    const q = `SELECT ?task ?who WHERE { ?task minerva:meta-status ?s ; minerva:references ?who . } ORDER BY ?task`;
    const first = await queryViewRows(project.ctx, q, 'sparql');
    if (!first.ok) throw new Error(first.error);
    expect(first.schema.noteColumn).toBe('task');
    expect(first.schema.columns).toEqual([{ name: 'who', type: 'link-to-type' }]);
    expect(first.rows[0]!.values['who']).toBe('Ann.md');
    const picked = await queryViewRows(project.ctx, q, 'sparql', { note: 'who' });
    expect(picked.ok && picked.schema.noteColumn).toBe('who');
    expect(picked.ok && picked.rows[0]!.path).toBe('Ann.md');
  });

  it('overrides retype a column; an unknown type is ignored', async () => {
    const r = await queryViewRows(project.ctx, STATUS, 'sparql', { columns: 'due:text, status:nonsense' });
    if (!r.ok) throw new Error(r.error);
    expect(r.schema.columns).toEqual([{ name: 'status', type: 'enum', options: ['done', 'todo'] }, { name: 'due', type: 'text' }]);
  });

  it('a malformed query, or an update, is { ok: false } with the reason', async () => {
    expect(await queryViewRows(project.ctx, 'SELECT WHERE {', 'sparql')).toMatchObject({ ok: false, error: expect.any(String) });
    expect(await queryViewRows(project.ctx, 'INSERT DATA { <a:b> <a:c> <a:d> }', 'sparql')).toMatchObject({ ok: false });
  });
});

describe('SQL (#2944)', () => {
  beforeEach(async () => {
    write('data/people.csv', 'name,note,born\nAnn,Ann.md,1980-02-01\nBo,,1975-06-30\n');
    write('.minerva/secrets.json', '{"key":"CANARY-QUERY-VIEW"}');
    await initTablesDb(project.ctx);
    expect((await registerCsv(project.ctx, 'data/people.csv')).ok).toBe(true);
  });
  afterEach(() => disposeProject(project.ctx));

  it('a registered table: paths name notes, an empty one is a row with no note, dates typed', async () => {
    const r = await queryViewRows(project.ctx, 'SELECT name, note, born FROM data_people ORDER BY name', 'sql');
    if (!r.ok) throw new Error(r.error);
    expect(r.schema.noteColumn).toBe('note');
    expect(r.schema.columns).toEqual([{ name: 'name', type: 'text' }, { name: 'born', type: 'date' }]);
    expect(r.rows.map((x) => [x.path, x.title])).toEqual([['Ann.md', 'Ann'], [null, 'Bo']]);
  });

  it('a list is its JSON, a BIGINT its exact digits, a DATE its day', async () => {
    const r = await queryViewRows(project.ctx, "SELECT [1, 2] AS xs, 9007199254740993::BIGINT AS big, DATE '2026-10-07' AS d", 'sql');
    if (!r.ok) throw new Error(r.error);
    expect(r.rows[0]!.values).toEqual({ xs: '[1,2]', big: '9007199254740993', d: '2026-10-07' });
  });

  it('goes through the note guard: a file read outside the registered tables is refused', async () => {
    const r = await queryViewRows(project.ctx, "SELECT * FROM read_text('.minerva/secrets.json')", 'sql');
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain('CANARY-QUERY-VIEW');
  });
});

describe('the cap (#2944)', () => {
  it(`draws at most ${QUERY_VIEW_ROW_LIMIT} rows and says it was cut`, async () => {
    const r = await queryViewRows(project.ctx, `SELECT ?i WHERE { VALUES ?x { 0 1 2 3 4 5 6 7 8 9 } VALUES ?y { 0 1 2 3 4 5 6 7 8 9 } VALUES ?z { 0 1 2 3 4 5 6 7 8 9 } VALUES ?w { 0 1 2 3 4 5 } BIND(?x * 1000 + ?y * 100 + ?z * 10 + ?w AS ?i) }`, 'sparql');
    if (!r.ok) throw new Error(r.error);
    expect(r.rows).toHaveLength(QUERY_VIEW_ROW_LIMIT);
    expect(r.truncated).toBe(true);
  });
});
