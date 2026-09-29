/**
 * @vitest-environment node
 *
 * "Accepted never leaks" — a property test of the model/note/agent SQL
 * relation allowlist (#2388, guarding #2442 / #2448 / #2452).
 *
 * The example matrix in `tests/main/sources/llm-sql-guard.test.ts` spells
 * each known file read once. This generates SELECTs from a small grammar that
 * COMBINES them: registered relations (a CSV view, a captioned markdown
 * table), CTEs whose names shadow those relations, subqueries in FROM /
 * WHERE / the select list / HAVING, UNION / EXCEPT / INTERSECT, LATERAL,
 * `range` / `generate_series` / `unnest`, and every file-reading form we know
 * (`read_text` / `read_csv` / `read_json_auto` / `read_blob` / `glob` /
 * `query()` / `query_table()` / `sniff_csv`, a bare `'path'`, a `"path"`
 * identifier) aimed at canary files in `.minerva/`.
 *
 * The oracle does not model the guard. It runs every statement the real
 * `guardSql` ACCEPTS on the real locked tables connection and asserts that
 * no canary appears anywhere in the result. Every selected row is projected
 * to one VARCHAR through its table alias (`CAST(a AS VARCHAR)` renders the
 * whole row), so a read that reached a canary cannot hide in a column the
 * query did not name. A precondition test proves the same connection DOES
 * read each canary when asked without the guard — otherwise "no canary in
 * the output" would hold vacuously.
 *
 * The accept / refuse / accepted-but-errored ratio is logged; if nearly
 * everything is refused the grammar has stopped exercising the accept path,
 * and `it('exercises the accept path')` fails.
 *
 * Counterexample convention: see `untrusted-content.property.test.ts`.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fc from 'fast-check';
import fs from 'node:fs';
import path from 'node:path';
import {
  initTablesDb, disposeProject, runQuery, registerCsv, registerMarkdownTable,
} from '../../src/main/sources/tables';
import { guardSql, type RowReader } from '../../src/main/sources/llm-sql-guard';
import { makeGraphProject, type GraphProject } from '../helpers/temp-project';
import { propertyParams } from '../helpers/property';

const CANARY_CSV = 'CANARY2388csv';
const CANARY_TXT = 'CANARY2388txt';
const CANARY_JSON = 'CANARY2388json';
const CANARIES = [CANARY_CSV, CANARY_TXT, CANARY_JSON];

let project: GraphProject;
let root = '';
let read: RowReader;

const stats = { accepted: 0, acceptedErrored: 0, refused: 0 };

beforeAll(async () => {
  project = await makeGraphProject('minerva-sqlprop-');
  root = fs.realpathSync(project.root);
  const m = path.join(root, '.minerva');
  fs.mkdirSync(path.join(m, 'conversations'), { recursive: true });
  fs.writeFileSync(path.join(m, 'leak.csv'), `secret,value\n${CANARY_CSV},1\n`);
  fs.writeFileSync(path.join(m, 'notes.txt'), `${CANARY_TXT}\n`);
  fs.writeFileSync(path.join(m, 'conversations', 'c1.json'), JSON.stringify({ content: CANARY_JSON }));
  fs.writeFileSync(path.join(root, 'sales.csv'), 'region,amount\nnorth,10\nsouth,20\n');
  await initTablesDb(project.ctx);
  expect((await registerCsv(project.ctx, 'sales.csv')).ok).toBe(true);
  const md = await registerMarkdownTable(
    project.ctx, 'notes/people.md',
    { headers: ['name', 'score'], rows: [['ann', '3'], ['bob', '5']], caption: 'people', name: 'people' }, 0,
  );
  expect(md.ok).toBe(true);
  // The exact RowReader `tables.ts` hands the guard, over `runQuery`'s connection.
  read = async (sql, params) => {
    const inlined = params.reduce((q, p) => q.replace('?', `'${p.replace(/'/g, "''")}'`), sql);
    const r = await runQuery(project.ctx, inlined);
    if (!r.ok) throw new Error(r.error);
    return r.rows;
  };
});

afterAll(async () => {
  // Reported so a grammar drifting toward all-refused shows in CI logs.
  console.info(`[sql-guard property] accepted ${stats.accepted} (errored at run time ${stats.acceptedErrored}), refused ${stats.refused}`);
  disposeProject(project.ctx);
  await project.cleanup();
});

// ── Grammar ────────────────────────────────────────────────────────────────
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
const abs = (rel: string) => path.join(root, rel);

/** Sources that read a canary file. Built lazily: `root` is set in beforeAll. */
function fileSources(): string[] {
  const csv = abs('.minerva/leak.csv');
  const txt = abs('.minerva/notes.txt');
  const json = abs('.minerva/conversations/c1.json');
  const glob = abs('.minerva/*');
  return [
    `read_text(${lit(txt)})`,
    `read_blob(${lit(txt)})`,
    `read_csv(${lit(csv)})`,
    `READ_CSV_AUTO(${lit(csv)})`,
    `main.read_text(${lit(txt)})`,
    `read_json_auto(${lit(json)})`,
    `read_text(${lit(glob)})`,
    `glob(${lit(glob)})`,
    `sniff_csv(${lit(csv)})`,
    `query(${lit(`SELECT * FROM read_text(${lit(txt)})`)})`,
    `query_table(${lit(csv)})`,
    lit(csv),
    ident(csv),
    ident(json),
    `read_text(${lit(path.dirname(txt))} || '/' || ${lit(path.basename(txt))})`,
  ];
}

const BENIGN_SOURCES = [
  'sales', 'people', 'SALES', 'main.sales', '"people"', 'memory.main.sales',
  'range(3)', 'generate_series(1, 4)', 'unnest([1, 2, 3])', 'duckdb_tables()',
];
/** CTE names: two fresh, two shadowing a registered relation. */
const CTE_NAMES = ['c1', 'c2', 'sales', 'people'];

const benignSource = fc.constantFrom(...BENIGN_SOURCES);
const fileSource = fc.integer({ min: 0, max: 100 }).map((i) => {
  const all = fileSources();
  return all[i % all.length]!;
});
const cteRef = fc.constantFrom('c1', 'c2');

const leafSource = fc.oneof(
  { weight: 6, arbitrary: benignSource },
  { weight: 1, arbitrary: fileSource },
  { weight: 2, arbitrary: cteRef },
);

const leafSelect = leafSource.map((src) => `SELECT CAST(a AS VARCHAR) AS v FROM ${src} AS a`);

const { select } = fc.letrec<{ select: string; source: string }>((tie) => {
  const sub = tie('select');
  const source = fc.oneof(
    { weight: 6, arbitrary: leafSource },
    { weight: 2, arbitrary: sub.map((s) => `(${s})`) },
  );
  const scalar = sub.map((s) => `(SELECT max(v) FROM (${s}) AS q)`);
  const extra = fc.oneof(
    { weight: 3, arbitrary: fc.constant('') },
    { weight: 1, arbitrary: scalar.map((s) => ` || coalesce(${s}, '')`) },
  );
  const join = fc.oneof(
    { weight: 4, arbitrary: fc.constant('') },
    { weight: 1, arbitrary: source.map((s) => ` JOIN ${s} AS b ON true`) },
    { weight: 1, arbitrary: sub.map((s) => `, LATERAL (${s}) AS b`) },
  );
  const where = fc.oneof(
    { weight: 4, arbitrary: fc.constant('') },
    { weight: 1, arbitrary: sub.map((s) => ` WHERE EXISTS (${s})`) },
    { weight: 1, arbitrary: sub.map((s) => ` WHERE CAST(a AS VARCHAR) NOT IN (${s})`) },
  );
  const plain = fc
    .tuple(extra, source, join, where)
    .map(([x, src, j, w]) => `SELECT CAST(a AS VARCHAR)${x} AS v FROM ${src} AS a${j}${w}`);
  const having = fc
    .tuple(source, scalar)
    .map(([src, s]) => `SELECT max(CAST(a AS VARCHAR)) AS v FROM ${src} AS a HAVING count(*) >= 0 AND coalesce(${s}, 'x') IS NOT NULL`);
  const setOp = fc
    .tuple(sub, fc.constantFrom('UNION ALL', 'UNION', 'EXCEPT', 'INTERSECT'), sub)
    .map(([l, op, r]) => `(${l}) ${op} (${r})`);
  const withCtes = fc
    .tuple(
      fc.array(fc.tuple(fc.constantFrom(...CTE_NAMES), sub), { minLength: 1, maxLength: 2 }),
      sub,
    )
    .map(([ctes, body]) => `WITH ${ctes.map(([n, s]) => `${n} AS (${s})`).join(', ')} ${body}`);
  return {
    select: fc.oneof(
      { maxDepth: 3, depthIdentifier: 'sql' },
      { weight: 3, arbitrary: leafSelect },
      { weight: 4, arbitrary: plain },
      { weight: 1, arbitrary: having },
      { weight: 1, arbitrary: setOp },
      { weight: 2, arbitrary: withCtes },
    ),
    source,
  };
});

const statement = fc.oneof(
  { weight: 9, arbitrary: select },
  { weight: 1, arbitrary: select.map((s) => `SUMMARIZE ${s}`) },
);

function leaked(rows: Record<string, unknown>[]): string | undefined {
  const text = JSON.stringify(rows, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v));
  return CANARIES.find((c) => text.includes(c));
}

// ── Tests ──────────────────────────────────────────────────────────────────
describe('model SQL guard: accepted never leaks (#2388)', () => {
  it('precondition: the unguarded connection reads every canary', async () => {
    for (const [src, canary] of [
      [`read_csv(${lit(abs('.minerva/leak.csv'))})`, CANARY_CSV],
      [`read_text(${lit(abs('.minerva/notes.txt'))})`, CANARY_TXT],
      [ident(abs('.minerva/conversations/c1.json')), CANARY_JSON],
    ] as const) {
      const r = await runQuery(project.ctx, `SELECT CAST(a AS VARCHAR) AS v FROM ${src} AS a`);
      expect(r.ok, `${src}: ${r.ok ? '' : r.error}`).toBe(true);
      if (r.ok) expect(leaked(r.rows)).toBe(canary);
    }
  });

  it('no statement the guard accepts returns a canary', async () => {
    await fc.assert(
      fc.asyncProperty(statement, fc.constantFrom('model', 'note', 'agent'), async (sql, audience) => {
        const verdict = await guardSql(read, sql, audience);
        if (!verdict.ok) {
          stats.refused++;
          for (const c of CANARIES) expect(verdict.reason).not.toContain(c);
          return;
        }
        stats.accepted++;
        const r = await runQuery(project.ctx, sql);
        if (!r.ok) {
          stats.acceptedErrored++;
          for (const c of CANARIES) expect(r.error, sql).not.toContain(c);
          return;
        }
        expect(leaked(r.rows), `accepted and leaked: ${sql}`).toBeUndefined();
      }),
      propertyParams(150),
    );
  });

  it('exercises the accept path (grammar health)', () => {
    // Runs after the property (vitest runs a file's tests in order). If the
    // grammar drifts so that nearly everything is refused — or accepted
    // queries all fail to bind — the property above holds vacuously.
    const total = stats.accepted + stats.refused;
    expect(total).toBeGreaterThan(0);
    expect(stats.accepted / total).toBeGreaterThan(0.2);
    expect(stats.refused / total).toBeGreaterThan(0.1);
    expect((stats.accepted - stats.acceptedErrored) / Math.max(1, stats.accepted)).toBeGreaterThan(0.5);
  });
});
