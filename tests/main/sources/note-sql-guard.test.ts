/**
 * @vitest-environment node
 *
 * Note-embedded SQL gets the registered-relations allowlist (#2448).
 *
 * A vega-lite `data.sql` / `data.table` chart and a `:::query-*` block with
 * `language: sql` run on preview — and the chart also on HTML export — with
 * nobody pressing Run. The tables DuckDB is locked to the thoughtbase root
 * (#2437), and `.minerva/` is inside the root, so before this a shared note
 * could draw `secrets.json` or a conversation transcript into a chart on
 * screen, or bake it into an HTML file the user then publishes.
 *
 * Drives the real `initTablesDb` + `registerCsv` against a hostile shared
 * note from `writeNoteSqlExfilThoughtbase` (#2372's fixtures), and checks:
 *   - every spelling is refused by `runNoteQuery` (what `tables:queryNote`
 *     and the export call), with a human-worded message and no canary;
 *   - the SAME statement on the unguarded `runQuery` does read the canary —
 *     so each refusal is load-bearing, not something DuckDB refused anyway;
 *   - the HTML export of the note holds no canary (base64 SVGs decoded) and
 *     an error placeholder per hostile chart, and still completes;
 *   - ordinary charts/queries over registered tables and CSV views still
 *     render, and the user-run paths (Query panel, SQL cells) still
 *     `read_csv` an in-root file.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initTablesDb, disposeProject, runQuery, runNoteQuery, registerCsv,
} from '../../../src/main/sources/tables';
import { projectContext } from '../../../src/main/project-context-types';
import { noteHtmlExporter } from '../../../src/main/publish/exporters/note-html';
import { renderVegaBlocks } from '../../../src/main/publish/vega-render';
import { executeSql } from '../../../src/main/compute/executors/sql';
import type { ExportPlan } from '../../../src/main/publish/types';
import {
  writeNoteSqlExfilThoughtbase, NOTE_SQL_CANARIES, type NoteSqlExfilFixture,
} from '../../helpers/hostile-thoughtbase';

const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-notesql-')));
let fx: NoteSqlExfilFixture;
let ctx: ReturnType<typeof projectContext>;

beforeAll(async () => {
  fx = writeNoteSqlExfilThoughtbase(path.join(base, 'tb'));
  ctx = projectContext(fx.root);
  await initTablesDb(ctx);
  expect((await registerCsv(ctx, fx.csvRelPath)).ok).toBe(true);
});

afterAll(() => {
  disposeProject(ctx);
  fs.rmSync(base, { recursive: true, force: true });
});

const CANARIES = Object.values(NOTE_SQL_CANARIES);

/** Every text an HTML export carries, with its base64 data-URI images decoded. */
function exportedText(html: string): string {
  const decoded = [...html.matchAll(/data:[a-z+/]+;base64,([A-Za-z0-9+/=]+)/g)]
    .map((m) => Buffer.from(m[1]!, 'base64').toString('utf8'));
  return [html, ...decoded].join('\n');
}

function exportPlan(content: string): ExportPlan {
  return {
    inputKind: 'single-note',
    inputs: [{ relativePath: 'shared.md', kind: 'note', content, frontmatter: {}, title: 'Shared' }],
    excluded: [],
    linkPolicy: 'inline-title',
    assetPolicy: 'keep-relative',
    rootPath: fx.root,
  };
}

describe('note SQL that reads .minerva/ is refused (#2448)', () => {
  it('has spellings to check', () => {
    expect(fx.spellings.length).toBeGreaterThan(10);
  });

  it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15])('spelling #%i', async (i) => {
    const [name, sql, canary] = fx.spellings[i]!;
    // Load-bearing: the unguarded path really does read the file.
    const raw = await runQuery(ctx, sql);
    expect(raw.ok, `${name} should read the file unguarded: ${raw.ok ? '' : raw.error}`).toBe(true);
    expect(JSON.stringify(raw.ok ? raw.rows : [])).toContain(canary);

    const r = await runNoteQuery(ctx, sql);
    expect(r.ok, `expected refusal for ${name}: ${sql}`).toBe(false);
    if (!r.ok) {
      for (const c of CANARIES) expect(r.error).not.toContain(c);
      expect(r.error).toMatch(/^Refused: /);
      // Worded for a person looking at a chart, not for the model.
      expect(r.error).toContain('Charts and query blocks in notes can only read the tables and views');
      expect(r.error).toContain('Registered tables and views: "sales"');
      expect(r.error).not.toContain('query_sql');
      expect(r.error).not.toContain('describe_tables');
    }
  });

  it('a data.table binding that names a file by path is refused too', async () => {
    const sql = `SELECT * FROM "${fx.secretsPath}"`; // tableQuerySql's shape
    expect(JSON.stringify((await runQuery(ctx, sql) as { rows?: unknown }).rows)).toContain(NOTE_SQL_CANARIES.secrets);
    const r = await runNoteQuery(ctx, sql);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).not.toContain(NOTE_SQL_CANARIES.secrets);
  });

  it('refuses a second statement and anything that is not a query', async () => {
    for (const sql of [
      'SELECT 1; SELECT 2',
      `COPY sales TO '${path.join(fx.root, 'out.csv')}'`,
      `ATTACH '${path.join(fx.root, 'x.db')}'`,
      'PRAGMA version',
    ]) {
      const r = await runNoteQuery(ctx, sql);
      expect(r.ok, sql).toBe(false);
    }
  });
});

describe('ordinary note SQL still runs (#2448)', () => {
  it.each([
    ['a registered CSV view', 'SELECT region, SUM(amount) AS total FROM sales GROUP BY region ORDER BY region'],
    ['the view by quoted name', 'SELECT * FROM "sales"'],
    ['a CTE over it', 'WITH s AS (SELECT * FROM sales) SELECT count(*) AS n FROM s'],
    ['generate_series', 'SELECT * FROM generate_series(1, 3)'],
    ['DESCRIBE', 'DESCRIBE sales'],
  ])('%s', async (_name, sql) => {
    const r = await runNoteQuery(ctx, sql);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
  });
});

describe('HTML export of the hostile note (#2448)', () => {
  it('contains no canary and an error placeholder per hostile chart, and still completes', async () => {
    const output = await noteHtmlExporter.run(exportPlan(fx.note));
    expect(output.files).toHaveLength(1);
    const html = String(output.files[0]!.contents);
    const text = exportedText(html);
    for (const c of CANARIES) expect(text).not.toContain(c);
    const placeholders = html.match(/Chart could not be rendered: data binding: Refused: /g) ?? [];
    expect(placeholders).toHaveLength(fx.hostileChartCount);
    // The one ordinary chart over the registered table still rendered.
    const svgs = html.match(/src="data:image\/svg\+xml;base64,/g) ?? [];
    expect(svgs).toHaveLength(1);
  });

  it('an ordinary data.sql chart renders to SVG with the registered rows', async () => {
    const md = '```vega-lite\n' + JSON.stringify({
      mark: 'text',
      data: { sql: "SELECT 'north-total-' || SUM(amount) AS content FROM sales WHERE region = 'north'" },
      encoding: { text: { field: 'content', type: 'nominal' } },
    }) + '\n```\n';
    const out = await renderVegaBlocks(md, { rootPath: fx.root });
    const m = out.match(/data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)/);
    expect(m, out).toBeTruthy();
    expect(Buffer.from(m![1]!, 'base64').toString('utf8')).toContain('north-total-15');
  });

  it('a data.table chart over a registered table renders', async () => {
    const md = '```vega-lite\n' + JSON.stringify({
      mark: 'bar',
      data: { table: 'sales' },
      encoding: { x: { field: 'region', type: 'nominal' }, y: { field: 'amount', type: 'quantitative' } },
    }) + '\n```\n';
    const out = await renderVegaBlocks(md, { rootPath: fx.root });
    expect(out).toContain('data:image/svg+xml;base64,');
  });
});

describe('what the user runs keeps full in-root access (#2448)', () => {
  const inRoot = () => path.join(fx.root, 'sales.csv');

  it('the Query panel path (runQuery) can read_csv an in-root file', async () => {
    const r = await runQuery(ctx, `SELECT count(*) AS n FROM read_csv('${inRoot()}')`);
    expect(r.ok, r.ok ? '' : r.error).toBe(true);
    if (r.ok) expect(Number(r.rows[0]!.n)).toBe(3);
  });

  it('a ```sql cell can read_csv an in-root file', async () => {
    const r = await executeSql(`SELECT count(*) AS n FROM read_csv('${inRoot()}')`, { rootPath: fx.root });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.output).toMatchObject({ type: 'table', columns: ['n'], rows: [[3]] });
  });
});
