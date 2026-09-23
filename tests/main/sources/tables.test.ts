import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initTablesDb, disposeProject, runQuery } from '../../../src/main/sources/tables';
import { projectContext } from '../../../src/main/project-context-types';
import { coerceDuckRowsForIpc } from '../../../src/main/compute/duck-values';

const ctx = projectContext('/tmp/minerva-tables-test');

describe('tables module — DuckDB lifecycle + runQuery (#232)', () => {
  beforeAll(async () => {
    await initTablesDb(ctx);
  });

  afterAll(() => {
    disposeProject(ctx);
  });

  it('runs the trivial round-trip query', async () => {
    const result = await runQuery(ctx, `SELECT 'hello' AS greeting`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.columns).toEqual(['greeting']);
      expect(result.rows).toEqual([{ greeting: 'hello' }]);
    }
  });

  it('returns structured error on malformed SQL instead of throwing', async () => {
    const result = await runQuery(ctx, 'SELEKT * FROM nothing');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/syntax|parser|SELEKT/i);
    }
  });

  it('returns structured error when a table is missing', async () => {
    const result = await runQuery(ctx, 'SELECT * FROM no_such_table');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/no_such_table|not found|does not exist/i);
    }
  });

  it('blocks httpfs extension autoload — no network egress from a SQL cell (#1325)', async () => {
    // A remote read forces DuckDB to autoload `httpfs`; with autoload
    // disabled at init (hardenConnection) it fails with a Missing Extension
    // error instead of reaching the network. Loopback host so the assertion
    // is about the block, not about DNS/connectivity.
    const result = await runQuery(
      ctx,
      "SELECT * FROM read_csv_auto('https://127.0.0.1/leak.csv')",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/extension|autoload|httpfs/i);
    }
  });

  it('still runs core built-in queries after the extension lockdown (#1325)', async () => {
    // The lockdown must not touch the built-ins the CSV pipeline relies on.
    const result = await runQuery(ctx, 'SELECT 1 AS n');
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows).toEqual([{ n: 1 }]);
  });

  it('handles multi-row / multi-column results with typed values', async () => {
    const result = await runQuery(ctx, `
      SELECT * FROM (VALUES
        (1, 'alpha', TRUE),
        (2, 'beta', FALSE),
        (3, 'gamma', TRUE)
      ) AS t(n, label, flag)
      ORDER BY n
    `);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.columns).toEqual(['n', 'label', 'flag']);
      expect(result.rows).toHaveLength(3);
      expect(result.rows[0]).toEqual({ n: 1, label: 'alpha', flag: true });
      expect(result.rows[2]).toEqual({ n: 3, label: 'gamma', flag: true });
    }
  });

  it('init is idempotent for the same project', async () => {
    await initTablesDb(ctx);
    const result = await runQuery(ctx, `SELECT 42 AS answer`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows[0]).toEqual({ answer: 42 });
  });

  it('two projects keep their tables isolated', async () => {
    const otherCtx = projectContext('/tmp/minerva-tables-test-other');
    await initTablesDb(otherCtx);
    try {
      await runQuery(ctx, `CREATE TABLE scratch (x INTEGER)`);
      await runQuery(ctx, `INSERT INTO scratch VALUES (1), (2)`);
      const inFirst = await runQuery(ctx, `SELECT COUNT(*) AS n FROM scratch`);
      expect(inFirst.ok).toBe(true);

      // The second project doesn't see the first project's table.
      const inSecond = await runQuery(otherCtx, `SELECT COUNT(*) AS n FROM scratch`);
      expect(inSecond.ok).toBe(false);
    } finally {
      disposeProject(otherCtx);
      // `ctx`'s DuckDB connection is shared with every other test in this
      // file (#1944) — drop the ad-hoc table rather than leaving it behind
      // for whatever test runs next to collide with.
      await runQuery(ctx, `DROP TABLE IF EXISTS scratch`);
    }
  });

  /**
   * The BigInt half of #2228, asserted against a real DuckDB rather than a
   * mocked row shape — the whole gap existed because the shape was assumed.
   *
   * INTEGER (32-bit) comes back as a JS number and BIGINT (64-bit) as a JS
   * `BigInt`; DuckDB's CSV sniffer types an integer column BIGINT and
   * `COUNT(*)`/`SUMMARIZE` return BIGINT too, so the bigint case is the
   * *ordinary* one for the `SELECT *` the Tables panel opens, not an edge.
   * `runQuery` deliberately still returns it raw; `coerceDuckRowsForIpc` at
   * the TABLES_QUERY boundary is what makes it JSON-safe.
   */
  it('a BIGINT column arrives raw, and the IPC coercion makes it JSON-safe (#2228)', async () => {
    const result = await runQuery(ctx, `
      SELECT 1 AS i32, 1::BIGINT AS i64, COUNT(*) AS n, 'x' AS label
      FROM (VALUES (1)) t(v)
    `);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(typeof result.rows[0]!.i32).toBe('number');
    expect(typeof result.rows[0]!.i64).toBe('bigint');
    expect(typeof result.rows[0]!.n).toBe('bigint');
    expect(() => JSON.stringify(result.rows)).toThrow(/BigInt/);

    const coerced = coerceDuckRowsForIpc(result.rows);
    expect(() => JSON.stringify(coerced)).not.toThrow();
    expect(coerced[0]).toEqual({ i32: 1, i64: 1, n: 1, label: 'x' });
    expect(typeof coerced[0]!.i64).toBe('number');
  });
});
