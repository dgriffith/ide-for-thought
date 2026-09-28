/**
 * The shared tables DuckDB is locked to the thoughtbase root (#2437).
 *
 * `query_sql` (an LLM tool with no approval gate), the Query panel, ```sql
 * cells, the Python bridge's `minerva.sql()` and vega specs all run on one
 * instance. These tests drive the real `initTablesDb` against a temp project
 * that has a sibling directory holding a "secret", and walk every DuckDB
 * file-reaching function and every path spelling we know of. A new DuckDB
 * version that loosens any of them fails here, not in a user's thoughtbase.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initTablesDb, disposeProject, runQuery, registerCsv, unregisterCsv,
} from '../../../src/main/sources/tables';
import { fileLockdownSql, sqlStringLiteral } from '../../../src/main/sources/duckdb-lockdown';
import { projectContext } from '../../../src/main/project-context-types';

const SECRET = 'CANARY-2437-outside-the-root';

// realpath'd base so the assertions below can name canonical paths; the root
// itself carries a `'` to prove the allowlist literal is escaped.
const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-lockdown-')));
const root = path.join(base, "tb'root");
const outside = path.join(base, 'outside');
// A sibling whose name has the root as a string prefix: `/x/tb'root` must not
// admit `/x/tb'rootx` — that is what the trailing separator is for.
const prefixSibling = `${root}x`;
const secretCsv = path.join(outside, 'secret.csv');
const ctx = projectContext(root);

const lit = sqlStringLiteral;

beforeAll(async () => {
  fs.mkdirSync(root);
  fs.mkdirSync(outside);
  fs.mkdirSync(prefixSibling);
  fs.writeFileSync(secretCsv, `k,v\nsecret,${SECRET}\n`);
  fs.writeFileSync(path.join(outside, 'secret.json'), JSON.stringify({ v: SECRET }));
  fs.writeFileSync(path.join(prefixSibling, 'near.csv'), `k,v\nnear,${SECRET}\n`);
  fs.writeFileSync(path.join(root, 'data.csv'), 'k,v\na,1\nb,2\n');
  fs.mkdirSync(path.join(root, 'sub'));
  fs.writeFileSync(path.join(root, 'sub', 'more.csv'), 'k,v\nc,3\n');
  // In-root symlinks pointing out: a file link and a directory link.
  fs.symlinkSync(secretCsv, path.join(root, 'link.csv'));
  fs.symlinkSync(outside, path.join(root, 'linkdir'));
  await initTablesDb(ctx);
});

afterAll(() => {
  disposeProject(ctx);
  fs.rmSync(base, { recursive: true, force: true });
});

async function expectRefused(sql: string): Promise<void> {
  const r = await runQuery(ctx, sql);
  expect(r.ok, `expected refusal for: ${sql}`).toBe(false);
  if (!r.ok) {
    expect(r.error).toMatch(/Permission Error|disabled|locked/i);
    expect(r.error).not.toContain(SECRET);
  }
}

describe('file functions outside the root are refused (#2437)', () => {
  const functions: [string, (p: string) => string][] = [
    ['read_text', (p) => `SELECT content FROM read_text(${lit(p)})`],
    ['read_blob', (p) => `SELECT content FROM read_blob(${lit(p)})`],
    ['read_csv', (p) => `SELECT * FROM read_csv(${lit(p)})`],
    ['read_csv_auto', (p) => `SELECT * FROM read_csv_auto(${lit(p)})`],
    ['read_json', (p) => `SELECT * FROM read_json(${lit(p)})`],
    ['read_json_auto', (p) => `SELECT * FROM read_json_auto(${lit(p)})`],
    ['read_parquet', (p) => `SELECT * FROM read_parquet(${lit(p)})`],
    ['glob', (p) => `SELECT * FROM glob(${lit(p)})`],
    ['bare path as a table', (p) => `SELECT * FROM ${lit(p)}`],
  ];
  for (const [name, sql] of functions) {
    it(`${name} of an absolute path outside the root`, async () => {
      await expectRefused(sql(secretCsv));
    });
  }

  const shapes: [string, string][] = [
    ['absolute path', secretCsv],
    ['`..` out of the root', `${root}/../outside/secret.csv`],
    ['relative `..`', '../outside/secret.csv'],
    ['`~` home expansion', '~/.ssh/id_rsa'],
    ['/etc/passwd', '/etc/passwd'],
    ['file:// URL', `file://${secretCsv}`],
    ['in-root symlink to a file outside', path.join(root, 'link.csv')],
    ['in-root symlinked directory', path.join(root, 'linkdir', 'secret.csv')],
    ['a sibling dir the root is a string prefix of', path.join(prefixSibling, 'near.csv')],
    ['glob pattern outside', `${outside}/*`],
    ['glob of the filesystem root', '/*'],
    ['https URL', 'https://127.0.0.1/leak.csv'],
  ];
  for (const [name, p] of shapes) {
    it(`read_text refuses ${name}`, async () => {
      await expectRefused(`SELECT content FROM read_text(${lit(p)})`);
    });
  }

  it('COPY … TO outside the root is refused and writes nothing', async () => {
    const target = path.join(outside, 'written.csv');
    await expectRefused(`COPY (SELECT 1 AS x) TO ${lit(target)}`);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('COPY … FROM outside the root is refused', async () => {
    await runQuery(ctx, 'CREATE OR REPLACE TABLE copy_target (k VARCHAR, v VARCHAR)');
    try {
      await expectRefused(`COPY copy_target FROM ${lit(secretCsv)}`);
    } finally {
      await runQuery(ctx, 'DROP TABLE IF EXISTS copy_target');
    }
  });

  it('ATTACH outside the root is refused and creates nothing', async () => {
    const target = path.join(outside, 'x.duckdb');
    await expectRefused(`ATTACH ${lit(target)} AS x`);
    expect(fs.existsSync(target)).toBe(false);
  });

  it('EXPORT DATABASE outside the root is refused', async () => {
    await expectRefused(`EXPORT DATABASE ${lit(path.join(outside, 'export'))}`);
    expect(fs.existsSync(path.join(outside, 'export', 'schema.sql'))).toBe(false);
  });

  it('extension INSTALL / LOAD are refused', async () => {
    await expectRefused('INSTALL httpfs');
    await expectRefused('LOAD httpfs');
  });
});

describe('the lockdown cannot be undone (#2437)', () => {
  const attempts = [
    "SET allowed_directories = ['/']",
    'RESET allowed_directories',
    "SET allowed_paths = ['/etc/passwd']",
    'SET enable_external_access = true',
    'SET GLOBAL enable_external_access = true',
    'RESET enable_external_access',
    'PRAGMA enable_external_access = true',
    'SET lock_configuration = false',
    'RESET lock_configuration',
    'SET autoload_known_extensions = true',
  ];
  for (const sql of attempts) {
    it(`refuses: ${sql}`, async () => {
      const r = await runQuery(ctx, sql);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/configuration has been locked/i);
    });
  }

  it('reports the locked settings', async () => {
    const r = await runQuery(ctx,
      "SELECT current_setting('enable_external_access') AS ext, current_setting('lock_configuration') AS locked");
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.rows[0]).toEqual({ ext: false, locked: true });
    // …and the refusal above still holds after the read.
    await expectRefused(`SELECT content FROM read_text(${lit(secretCsv)})`);
  });
});

describe('inside the root still works (#2437)', () => {
  it('reads a file under the root by absolute path', async () => {
    const r = await runQuery(ctx, `SELECT count(*) AS n FROM read_csv(${lit(path.join(root, 'data.csv'))})`);
    expect(r.ok).toBe(true);
    if (r.ok) expect(Number(r.rows[0]!.n)).toBe(2);
  });

  it('globs under the root, without descending through a directory link', async () => {
    const r = await runQuery(ctx, `SELECT file FROM glob(${lit(`${root}/**/*.csv`)}) ORDER BY file`);
    expect(r.ok).toBe(true);
    if (r.ok) {
      const files = r.rows.map((row) => String(row.file));
      expect(files).toContain(path.join(root, 'data.csv'));
      expect(files).toContain(path.join(root, 'sub', 'more.csv'));
      // `**` does not descend through the directory link to list what's outside.
      expect(files.some((f) => f.includes('linkdir') || f.startsWith(outside))).toBe(false);
    }
  });

  it('registers a CSV view and queries it — through a root whose name needs escaping', async () => {
    const res = await registerCsv(ctx, 'data.csv');
    expect(res).toEqual({ ok: true });
    try {
      const r = await runQuery(ctx, 'SELECT k, v FROM data ORDER BY k');
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.rows).toEqual([{ k: 'a', v: 1n }, { k: 'b', v: 2n }]);
      // A lazy view re-reads the file per query, so an edit shows up.
      fs.writeFileSync(path.join(root, 'data.csv'), 'k,v\na,1\nb,2\nz,26\n');
      const again = await runQuery(ctx, 'SELECT count(*) AS n FROM data');
      if (again.ok) expect(Number(again.rows[0]!.n)).toBe(3);
    } finally {
      await unregisterCsv(ctx, 'data.csv');
    }
  });

  it('refuses to register an in-root CSV symlink that points outside', async () => {
    const res = await registerCsv(ctx, 'link.csv');
    expect(res.ok).toBe(false);
    const r = await runQuery(ctx, 'SELECT * FROM link');
    expect(r.ok).toBe(false);
  });

  it('COPY … TO inside the root is allowed (a user cell exporting into the thoughtbase)', async () => {
    const target = path.join(root, 'export.csv');
    const r = await runQuery(ctx, `COPY (SELECT 1 AS x) TO ${lit(target)}`);
    expect(r.ok).toBe(true);
    expect(fs.readFileSync(target, 'utf-8')).toContain('x');
  });
});

describe('root spelling (#2437)', () => {
  it('a root opened through a symlinked path still reads its own CSVs', async () => {
    // The allowlist holds the realpath; DuckDB resolves the target the same
    // way, so a root reached through a link (macOS /var → /private/var) works.
    const linkRoot = path.join(base, 'root-link');
    fs.symlinkSync(root, linkRoot);
    const linked = projectContext(linkRoot);
    await initTablesDb(linked);
    try {
      expect(await registerCsv(linked, 'sub/more.csv')).toEqual({ ok: true });
      const r = await runQuery(linked, 'SELECT k FROM sub_more');
      expect(r.ok).toBe(true);
      const out = await runQuery(linked, `SELECT content FROM read_text(${lit(secretCsv)})`);
      expect(out.ok).toBe(false);
    } finally {
      disposeProject(linked);
    }
  });

  it('fails closed when the root cannot be resolved', async () => {
    const missing = projectContext(path.join(base, 'does-not-exist'));
    await expect(initTablesDb(missing)).rejects.toThrow(/ENOENT/);
    // Nothing was registered for it, so no unlocked instance is reachable.
    const r = await runQuery(missing, 'SELECT 1');
    expect(r).toEqual({ ok: false, error: 'Tables DB is not initialized' });
  });
});

describe('fileLockdownSql (#2437)', () => {
  it('quotes each directory, adds the trailing separator, and locks last', () => {
    const sql = fileLockdownSql(["/a/it's", '/b/']);
    expect(sql).toBe(
      "SET allowed_directories = ['/a/it''s/', '/b/']; " +
      'SET enable_external_access = false; ' +
      'SET lock_configuration = true;',
    );
  });

  it('refuses an empty allowlist rather than emitting `[]`', () => {
    expect(() => fileLockdownSql([])).toThrow();
  });
});
