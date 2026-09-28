/**
 * @vitest-environment node
 *
 * The relation allowlist on model-authored SQL (#2442).
 *
 * The tables instance is locked to the thoughtbase root (#2437), and
 * `.minerva/` is inside the root, so the lock alone lets `query_sql` read
 * conversation transcripts and `secrets.json`. These tests drive the real
 * `initTablesDb` + `registerCsv` against a temp thoughtbase that has both,
 * and check every spelling of a file read we know of against
 * `checkModelSql` — then run each refused statement for real on the same
 * connection to prove it WOULD have read the file (so a refusal here is
 * load-bearing, not a statement DuckDB would have rejected anyway).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initTablesDb, disposeProject, runQuery, registerCsv, checkModelSql,
} from '../../../src/main/sources/tables';
import {
  checkSerializedSql, describeRegistered, guardModelSql,
  type CatalogRelation,
} from '../../../src/main/sources/llm-sql-guard';
import { querySql } from '../../../src/main/llm/tools/query-sql';
import { projectContext } from '../../../src/main/project-context-types';

const CONVO = 'CANARY-2442-conversation-transcript';
const SECRET = 'CANARY-2442-secrets-json';
const NOTE = 'CANARY-2442-in-root-note';

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-sqlguard-')));
const root = path.join(base, 'tb');
const ctx = projectContext(root);
const conv = path.join(root, '.minerva', 'conversations', 'c1.json');
const secrets = path.join(root, '.minerva', 'secrets.json');
const note = path.join(root, 'notes', 'private.md');

beforeAll(async () => {
  fs.mkdirSync(path.join(root, '.minerva', 'conversations'), { recursive: true });
  fs.mkdirSync(path.join(root, 'notes'));
  fs.writeFileSync(conv, JSON.stringify({ messages: [{ role: 'user', content: CONVO }] }));
  fs.writeFileSync(secrets, JSON.stringify({ openai: SECRET }));
  fs.writeFileSync(note, `# Private\n\n${NOTE}\n`);
  fs.writeFileSync(path.join(root, 'sales.csv'), 'region,amount\nnorth,10\nsouth,20\nnorth,5\n');
  fs.writeFileSync(path.join(root, 'regions.csv'), 'region,manager\nnorth,ann\nsouth,bob\n');
  await initTablesDb(ctx);
  expect((await registerCsv(ctx, 'sales.csv')).ok).toBe(true);
  expect((await registerCsv(ctx, 'regions.csv')).ok).toBe(true);
});

afterAll(() => {
  disposeProject(ctx);
  fs.rmSync(base, { recursive: true, force: true });
});

const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
const qi = (s: string) => `"${s.replace(/"/g, '""')}"`;

// ── refused: every spelling of "read a file inside the root" ───────────────
const targets: [string, string, string][] = [
  ['conversation transcript', conv, CONVO],
  ['secrets.json', secrets, SECRET],
  ['an in-root note', note, NOTE],
];

function spellings(p: string): [string, string][] {
  const convGlob = path.join(root, '.minerva', 'conversations', '*');
  return [
    ['read_text', `SELECT content FROM read_text(${q(p)})`],
    ['read_blob', `SELECT content FROM read_blob(${q(p)})`],
    ['read_csv', `SELECT * FROM read_csv(${q(p)}, header=false, sep='\\0')`],
    ['read_json', `SELECT * FROM read_json(${q(p)})`],
    ['read_json_auto', `SELECT * FROM read_json_auto(${q(p)})`],
    ['glob', `SELECT * FROM glob(${q(convGlob)})`],
    ['READ_TEXT (case)', `SELECT content FROM READ_TEXT(${q(p)})`],
    ['schema-qualified main.read_text', `SELECT content FROM main.read_text(${q(p)})`],
    ['catalog-qualified system.main.read_text', `SELECT content FROM system.main.read_text(${q(p)})`],
    ['|| built path', `SELECT content FROM read_text(${q(path.dirname(p))} || '/' || ${q(path.basename(p))})`],
    ['bare string path', `SELECT * FROM ${q(p)}`],
    ['quoted identifier path', `SELECT * FROM ${qi(p)}`],
    ['FROM-first bare path', `FROM ${q(p)}`],
    ['CTE-wrapped', `WITH x AS (SELECT * FROM read_text(${q(p)})) SELECT * FROM x`],
    ['CTE self-shadow', `WITH ${qi(p)} AS (SELECT * FROM ${qi(p)}) SELECT * FROM ${qi(p)}`],
    ['CTE named like a real table', `WITH sales AS (SELECT content AS region FROM read_text(${q(p)})) SELECT * FROM sales`],
    ['CTE forward reference', `WITH y AS (SELECT * FROM ${qi(p)}), ${qi(p)} AS (SELECT 1 AS z) SELECT * FROM y`],
    ['CTE out of scope', `SELECT * FROM (WITH ${qi(p)} AS (SELECT 1 AS z) SELECT 1), ${qi(p)}`],
    ['recursive CTE anchor self-ref', `WITH RECURSIVE ${qi(p)} AS (SELECT * FROM ${qi(p)} UNION ALL SELECT 1) SELECT * FROM ${qi(p)}`],
    ['subquery in WHERE', `SELECT * FROM sales WHERE region IN (SELECT content FROM read_text(${q(p)}))`],
    ['EXISTS subquery', `SELECT 1 WHERE EXISTS (SELECT * FROM ${q(p)})`],
    ['scalar subquery in select list', `SELECT (SELECT content FROM read_text(${q(p)})) AS c`],
    ['subquery in HAVING', `SELECT region FROM sales GROUP BY region HAVING max(region) < (SELECT content FROM read_text(${q(p)}))`],
    ['UNION-ed', `SELECT region FROM sales UNION ALL SELECT content FROM read_text(${q(p)})`],
    ['INTERSECT / EXCEPT arm', `SELECT region FROM sales EXCEPT SELECT content FROM read_text(${q(p)})`],
    ['LATERAL', `SELECT * FROM sales, LATERAL (SELECT content FROM read_text(${q(p)}))`],
    ['JOIN arm', `SELECT * FROM sales JOIN read_text(${q(p)}) ON true`],
    ['table-function argument subquery', `SELECT * FROM range((SELECT length(content) FROM read_text(${q(p)})))`],
    ['query()', `SELECT * FROM query(${q(`SELECT content FROM read_text(${q(p)})`)})`],
    ['query_table()', `SELECT * FROM query_table(${q(p)})`],
    ['json_execute_serialized_sql', `SELECT * FROM json_execute_serialized_sql(json_serialize_sql(${q(`SELECT content FROM read_text(${q(p)})`)}))`],
    ['DESCRIBE a path', `DESCRIBE ${q(p)}`],
    ['SUMMARIZE a path', `SUMMARIZE ${q(p)}`],
    ['SHOW a path', `SHOW ${qi(p)}`],
    ['PIVOT over a path', `SELECT * FROM (PIVOT ${q(p)} ON content IN ('x') USING count(*))`],
    ['sniff_csv', `SELECT * FROM sniff_csv(${q(p)})`],
    ['parquet_metadata', `SELECT * FROM parquet_metadata(${q(p)})`],
  ];
}

describe('model SQL that reads a file is refused (#2442)', () => {
  for (const [what, file, canary] of targets) {
    describe(what, () => {
      for (const [name, sql] of spellings(file)) {
        it(name, async () => {
          const verdict = await checkModelSql(ctx, sql);
          expect(verdict.ok, `expected refusal for: ${sql}`).toBe(false);
          if (!verdict.ok) {
            expect(verdict.reason).not.toContain(canary);
            expect(verdict.reason).toMatch(/Registered tables and views: "regions", "sales"/);
          }
        });
      }
    });
  }

  // Without the guard, the lockdown alone lets these through: that is the
  // hole. If one of these stops reading the file, a DuckDB change closed it
  // too — and the spelling above is no longer proving anything.
  it.each([
    ['read_text', `SELECT content FROM read_text(${q(conv)})`, CONVO],
    ['bare path', `SELECT * FROM ${q(secrets)}`, SECRET],
    ['quoted identifier', `SELECT * FROM ${qi(secrets)}`, SECRET],
    ['CTE self-shadow', `WITH ${qi(secrets)} AS (SELECT * FROM ${qi(secrets)}) SELECT * FROM ${qi(secrets)}`, SECRET],
    ['CTE out of scope', `SELECT * FROM (WITH ${qi(secrets)} AS (SELECT 1 AS z) SELECT 1), ${qi(secrets)}`, SECRET],
    ['query()', `SELECT * FROM query(${q(`SELECT content FROM read_text(${q(note)})`)})`, NOTE],
    ['SUMMARIZE', `SUMMARIZE ${q(secrets)}`, SECRET],
  ])('the unguarded connection really does read it: %s', async (_n, sql, canary) => {
    const r = await runQuery(ctx, sql);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(r, (_k, v: unknown) => (typeof v === 'bigint' ? Number(v) : v))).toContain(canary);
  });

  it.each([
    ['PRAGMA', 'PRAGMA version'],
    ['SET', "SET threads = 1"],
    ['COPY', `COPY (SELECT 1) TO ${q(path.join(root, 'x.csv'))}`],
    ['ATTACH', `ATTACH ${q(path.join(root, 'x.db'))}`],
    ['INSTALL', 'INSTALL httpfs'],
    ['LOAD', 'LOAD httpfs'],
    ['EXPLAIN', 'EXPLAIN SELECT 1'],
    ['CREATE VIEW', `CREATE VIEW v AS SELECT * FROM read_text(${q(secrets)})`],
    ['two statements', 'SELECT 1; SELECT 2'],
    ['a parse error', 'SELEC 1'],
    ['top-level PIVOT', 'PIVOT sales ON region USING sum(amount)'],
  ])('%s is refused', async (_n, sql) => {
    const verdict = await checkModelSql(ctx, sql);
    expect(verdict.ok).toBe(false);
  });

  it.each([
    ['json_serialize_plan', `SELECT json_serialize_plan(${q(`SELECT * FROM read_csv(${q(secrets)})`)})`],
    ['current_setting', "SELECT current_setting('allowed_directories')"],
    ['write_log', "SELECT write_log('x')"],
    ['getenv', "SELECT getenv('HOME')"],
  ])('scalar %s() is refused', async (_n, sql) => {
    const verdict = await checkModelSql(ctx, sql);
    expect(verdict.ok).toBe(false);
    if (!verdict.ok) expect(verdict.reason).toMatch(/function .*\(\) is not available/);
  });
});

// ── allowed: ordinary analysis over what Minerva registered ────────────────
describe('ordinary queries over registered relations run (#2442)', () => {
  it.each([
    ['select', 'SELECT * FROM sales'],
    ['case-insensitive name', 'SELECT * FROM SALES'],
    ['quoted name', 'SELECT * FROM "sales"'],
    ['schema-qualified', 'SELECT * FROM main.sales'],
    ['catalog-qualified', 'SELECT * FROM memory.main.sales'],
    ['FROM-first', 'FROM sales'],
    ['TABLE', 'TABLE sales'],
    ['join', 'SELECT s.region, r.manager, s.amount FROM sales s JOIN regions r USING (region)'],
    ['aggregate', 'SELECT region, sum(amount) AS total FROM sales GROUP BY region HAVING count(*) > 0 ORDER BY 1'],
    ['window', 'SELECT region, amount, row_number() OVER (PARTITION BY region ORDER BY amount) AS rn FROM sales QUALIFY rn = 1'],
    ['CTE chain', 'WITH a AS (SELECT * FROM sales), b AS (SELECT region, sum(amount) t FROM a GROUP BY ALL) SELECT * FROM b'],
    ['CTE in a subquery', 'WITH a AS (SELECT * FROM sales) SELECT * FROM regions WHERE region IN (SELECT region FROM a)'],
    ['CTE in a set operation', 'WITH a AS (SELECT region FROM sales) SELECT region FROM regions UNION SELECT region FROM a'],
    ['recursive CTE', 'WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r WHERE n < 5) SELECT sum(n) FROM r'],
    ['LATERAL', 'SELECT * FROM sales, LATERAL (SELECT sales.amount * 2 AS double)'],
    ['range', 'SELECT * FROM range(5)'],
    ['generate_series', 'SELECT * FROM generate_series(1, 3)'],
    ['unnest', 'SELECT * FROM unnest([1, 2, 3])'],
    ['VALUES', 'SELECT * FROM (VALUES (1, 2)) v(a, b)'],
    ['SUMMARIZE', 'SUMMARIZE sales'],
    ['SUMMARIZE a query', 'SUMMARIZE SELECT amount FROM sales'],
    ['DESCRIBE', 'DESCRIBE sales'],
    ['SHOW TABLES', 'SHOW TABLES'],
    ['SHOW ALL TABLES', 'SHOW ALL TABLES'],
    ['PIVOT subquery', "SELECT * FROM (PIVOT sales ON region IN ('north', 'south') USING sum(amount))"],
    ['statistics', 'SELECT corr(amount, amount), quantile_cont(amount, 0.5), stddev_samp(amount) FROM sales'],
    ['expressions', "SELECT CASE WHEN amount BETWEEN 1 AND 10 THEN 'lo' ELSE 'hi' END, amount::DECIMAL(10,2), list_transform([amount], x -> x + 1), {'k': region}, region ILIKE 'n%' FROM sales"],
    ['duckdb_columns', "SELECT column_name FROM duckdb_columns() WHERE table_name = 'sales'"],
    ['information_schema', "SELECT table_name FROM information_schema.tables"],
    ['pg_catalog view unqualified', 'SELECT count(*) FROM pg_tables'],
  ])('%s', async (_n, sql) => {
    const verdict = await checkModelSql(ctx, sql);
    expect(verdict, sql).toEqual({ ok: true });
    const r = await runQuery(ctx, sql);
    expect(r.ok, sql).toBe(true);
  });
});

// ── the query_sql tool end to end ──────────────────────────────────────────
describe('query_sql applies the allowlist (#2442)', () => {
  it('refuses a .minerva read with a message that lists the registered tables', async () => {
    const r = await querySql.run({ rootPath: root }, { sql: `SELECT content FROM read_text(${q(conv)})` });
    expect(r.isError).toBe(true);
    expect(r.content).not.toContain(CONVO);
    expect(r.content).toMatch(/table function read_text\(\) is not available to query_sql/);
    expect(r.content).toMatch(/Registered tables and views: "regions", "sales"\./);
  });

  it('refuses a bare-path read of secrets.json', async () => {
    const r = await querySql.run({ rootPath: root }, { sql: `SELECT * FROM ${q('.minerva/secrets.json')}` });
    expect(r.isError).toBe(true);
    expect(r.content).toMatch(/"\.minerva\/secrets\.json" is not a registered table or view/);
  });

  it('still answers an ordinary query', async () => {
    const r = await querySql.run({ rootPath: root }, { sql: 'SELECT region, sum(amount) AS t FROM sales GROUP BY region ORDER BY region' });
    expect(r.isError).toBe(false);
    expect(JSON.parse(r.content)).toEqual([{ region: 'north', t: 15 }, { region: 'south', t: 20 }]);
  });
});

// ── the other callers are unchanged ────────────────────────────────────────
describe('non-LLM callers keep the full locked connection (#2442)', () => {
  it('runQuery (Query panel, SQL cells, minerva.sql(), vega) can still read_csv an in-root file', async () => {
    const r = await runQuery(ctx, `SELECT * FROM read_csv(${q(path.join(root, 'sales.csv'))}) ORDER BY amount`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows).toHaveLength(3);
  });
});

// ── pinned raw ASTs: a DuckDB upgrade that changes the shape fails here ────
describe('json_serialize_sql shapes the walker is written against (DuckDB 1.5.3)', () => {
  async function ast(sql: string): Promise<Record<string, unknown>> {
    const r = await runQuery(ctx, `SELECT json_serialize_sql(${q(sql)}) AS j`);
    if (!r.ok) throw new Error(r.error);
    return JSON.parse(String(r.rows[0]!.j)) as Record<string, unknown>;
  }
  function strip(v: unknown): unknown {
    if (Array.isArray(v)) return v.map(strip);
    if (v && typeof v === 'object') {
      return Object.fromEntries(Object.entries(v).filter(([k]) => k !== 'query_location').map(([k, x]) => [k, strip(x)]));
    }
    return v;
  }

  it('a bare path is a BASE_TABLE named by the path (the replacement-scan shape)', async () => {
    const node = (strip(await ast("SELECT * FROM '.minerva/secrets.json'")) as {
      statements: { node: { from_table: unknown } }[];
    }).statements[0]!.node.from_table;
    expect(node).toEqual({
      type: 'BASE_TABLE', alias: '', sample: null, schema_name: '', table_name: '.minerva/secrets.json',
      column_name_alias: [], catalog_name: '', at_clause: null,
    });
  });

  it('a file function is a TABLE_FUNCTION whose function is a FUNCTION node', async () => {
    const node = (strip(await ast("SELECT * FROM main.READ_TEXT('x')")) as {
      statements: { node: { from_table: Record<string, unknown> } }[];
    }).statements[0]!.node.from_table;
    expect(node.type).toBe('TABLE_FUNCTION');
    expect(node.function).toMatchObject({ class: 'FUNCTION', type: 'FUNCTION', function_name: 'read_text', schema: 'main', catalog: '' });
  });

  it('CTEs are an ordered cte_map on the query node, bodies wrapped as statements', async () => {
    const node = (strip(await ast('WITH z AS (SELECT 1), a AS (SELECT * FROM z) SELECT * FROM a')) as {
      statements: { node: { type: string; cte_map: { map: { key: string; value: { query: { node: { type: string } } } }[] } } }[];
    }).statements[0]!.node;
    expect(node.type).toBe('SELECT_NODE');
    expect(node.cte_map.map.map((e) => e.key)).toEqual(['z', 'a']);
    expect(node.cte_map.map[1]!.value.query.node.type).toBe('SELECT_NODE');
  });

  it('a recursive CTE body is a RECURSIVE_CTE_NODE with left / right / cte_name', async () => {
    const node = (strip(await ast('WITH RECURSIVE r(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM r) SELECT * FROM r')) as {
      statements: { node: { cte_map: { map: { value: { query: { node: Record<string, unknown> } } }[] } } }[];
    }).statements[0]!.node.cte_map.map[0]!.value.query.node;
    expect(node).toMatchObject({ type: 'RECURSIVE_CTE_NODE', cte_name: 'r' });
    expect(node).toHaveProperty('left');
    expect(node).toHaveProperty('right');
  });

  it('DESCRIBE / SUMMARIZE wrap the relation in a SHOW_REF query; SHOW TABLES names a keyword', async () => {
    const from = async (sql: string) => (strip(await ast(sql)) as {
      statements: { node: { from_table: Record<string, unknown> } }[];
    }).statements[0]!.node.from_table;
    expect(await from('SUMMARIZE sales')).toMatchObject({ type: 'SHOW_REF', table_name: '', show_type: 'SUMMARY' });
    expect(await from('DESCRIBE sales')).toMatchObject({ type: 'SHOW_REF', table_name: '', show_type: 'DESCRIBE' });
    expect(await from('SHOW TABLES')).toMatchObject({ type: 'SHOW_REF', table_name: '"tables"', query: null });
  });

  it('a non-SELECT statement is a serializer error, not a tree', async () => {
    expect(await ast('PRAGMA version')).toMatchObject({ error: true, error_message: 'Only SELECT statements can be serialized to json!' });
  });
});

// ── the pure checker's fail-closed edges ───────────────────────────────────
describe('checkSerializedSql fails closed', () => {
  const catalog: CatalogRelation[] = [{ database: 'memory', schema: 'main', name: 'sales', internal: false }];
  const select = (from: unknown, extra: Record<string, unknown> = {}) => ({
    error: false,
    statements: [{ node: { type: 'SELECT_NODE', modifiers: [], cte_map: { map: [] }, select_list: [], from_table: from, ...extra }, named_param_map: [] }],
  });
  const baseRef = (name: string) => ({ type: 'BASE_TABLE', schema_name: '', catalog_name: '', table_name: name });

  it('accepts a known relation', () => {
    expect(checkSerializedSql(select(baseRef('sales')), catalog)).toEqual({ ok: true });
  });

  it('refuses an unknown table-ref kind', () => {
    const v = checkSerializedSql(select({ type: 'FUTURE_FILE_REF', path: 'x' }), catalog);
    expect(v).toEqual({ ok: false, reason: 'unsupported query element FUTURE_FILE_REF' });
  });

  it('refuses an unknown expression class', () => {
    const v = checkSerializedSql(select(baseRef('sales'), { select_list: [{ class: 'FUTURE_EXPR', type: 'X' }] }), catalog);
    expect(v).toEqual({ ok: false, reason: 'unsupported expression kind FUTURE_EXPR' });
  });

  it('refuses an unknown query-node kind nested under a subquery', () => {
    const v = checkSerializedSql(select({ type: 'SUBQUERY', subquery: { node: { type: 'FUTURE_NODE' } } }), catalog);
    expect(v.ok).toBe(false);
  });

  it('refuses a malformed CTE list', () => {
    expect(checkSerializedSql(select(baseRef('sales'), { cte_map: { map: 'x' } }), catalog).ok).toBe(false);
    expect(checkSerializedSql(select(baseRef('sales'), { cte_map: { map: [{ nokey: 1 }] } }), catalog).ok).toBe(false);
  });

  it('refuses a TABLE_FUNCTION whose function is not a FUNCTION node', () => {
    expect(checkSerializedSql(select({ type: 'TABLE_FUNCTION', function: { class: 'CONSTANT' } }), catalog).ok).toBe(false);
  });

  it('refuses an unknown SHOW target and a SHOW with both a name and a query', () => {
    expect(checkSerializedSql(select({ type: 'SHOW_REF', table_name: 'secrets.json', query: null, show_type: 'SHOW_UNQUALIFIED' }), catalog).ok).toBe(false);
    expect(checkSerializedSql(select({ type: 'SHOW_REF', table_name: 'x', query: { type: 'SELECT_NODE' }, show_type: 'DESCRIBE' }), catalog).ok).toBe(false);
    expect(checkSerializedSql(select({ type: 'SHOW_REF', table_name: '', query: null, show_type: 'SHOW_FROM' }), catalog).ok).toBe(true);
  });

  it('refuses a qualified name that resolves nowhere, and a relation named by a non-identifier', () => {
    expect(checkSerializedSql(select({ ...baseRef('sales'), schema_name: 'other' }), catalog).ok).toBe(false);
    expect(checkSerializedSql(select({ ...baseRef('sales'), catalog_name: 'other', schema_name: 'main' }), catalog).ok).toBe(false);
    expect(checkSerializedSql(select(baseRef('')), catalog).ok).toBe(false);
    expect(checkSerializedSql(select(baseRef('sales.csv')), [...catalog, { database: 'memory', schema: 'main', name: 'sales.csv', internal: false }]).ok).toBe(false);
  });

  it('refuses a serializer error, a non-object, and zero or several statements', () => {
    expect(checkSerializedSql(null, catalog).ok).toBe(false);
    expect(checkSerializedSql({ error: true, error_message: 'Parser Error: boom' }, catalog)).toEqual({
      ok: false, reason: 'the statement could not be parsed: Parser Error: boom',
    });
    expect(checkSerializedSql({ error: true }, catalog)).toEqual({ ok: false, reason: 'the statement could not be parsed' });
    expect(checkSerializedSql({ error: false, statements: [] }, catalog).ok).toBe(false);
  });

  it('rethrows anything that is not a refusal', () => {
    const hostile = select(baseRef('sales'));
    Object.defineProperty(hostile.statements[0]!.node, 'boom', { enumerable: true, get: () => { throw new TypeError('bug'); } });
    expect(() => checkSerializedSql(hostile, catalog)).toThrow(TypeError);
  });

  it('describes an empty and a long catalog', () => {
    expect(describeRegistered([])).toBe('There are no registered tables in this thoughtbase.');
    const many = Array.from({ length: 55 }, (_, i) => ({ database: 'memory', schema: 'main', name: `t${String(i).padStart(2, '0')}`, internal: false }));
    expect(describeRegistered(many)).toMatch(/"t49" \(and 5 more\)\.$/);
  });

  it('guardModelSql treats an unparseable serializer answer as a refusal', async () => {
    const v = await guardModelSql(async (sql) => (sql.includes('json_serialize_sql') ? [{ ast: 'not json' }] : []), 'SELECT 1');
    expect(v.ok).toBe(false);
  });

  it('checkModelSql refuses when the tables DB is not open', async () => {
    const v = await checkModelSql(projectContext(path.join(base, 'never-opened')), 'SELECT 1');
    expect(v).toEqual({ ok: false, reason: 'Tables DB is not initialized' });
  });
});
