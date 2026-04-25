import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initTablesDb, disposeProject, runQuery } from '../../../src/main/sources/tables';
import { projectContext } from '../../../src/main/project-context-types';

const ctx = projectContext('/tmp/minerva-tables-test');

describe('tables module — DuckDB lifecycle + runQuery (#232)', () => {
  beforeAll(async () => {
    await initTablesDb(ctx);
  });

  afterAll(async () => {
    await disposeProject(ctx);
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
      await disposeProject(otherCtx);
    }
  });
});
