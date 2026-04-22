import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { initTablesDb, closeTablesDb, runQuery } from '../../../src/main/sources/tables';

describe('tables module — DuckDB lifecycle + runQuery (#232)', () => {
  beforeAll(async () => {
    await initTablesDb('/tmp/minerva-tables-test');
  });

  afterAll(async () => {
    await closeTablesDb();
  });

  it('runs the trivial round-trip query', async () => {
    const result = await runQuery(`SELECT 'hello' AS greeting`);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.columns).toEqual(['greeting']);
      expect(result.rows).toEqual([{ greeting: 'hello' }]);
    }
  });

  it('returns structured error on malformed SQL instead of throwing', async () => {
    const result = await runQuery('SELEKT * FROM nothing');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/syntax|parser|SELEKT/i);
    }
  });

  it('returns structured error when a table is missing', async () => {
    const result = await runQuery('SELECT * FROM no_such_table');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/no_such_table|not found|does not exist/i);
    }
  });

  it('handles multi-row / multi-column results with typed values', async () => {
    const result = await runQuery(`
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

  it('init is idempotent for the same root', async () => {
    await initTablesDb('/tmp/minerva-tables-test');
    const result = await runQuery(`SELECT 42 AS answer`);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.rows[0]).toEqual({ answer: 42 });
  });

  it('re-init on a different root closes the previous connection', async () => {
    await runQuery(`CREATE TABLE scratch (x INTEGER)`);
    await runQuery(`INSERT INTO scratch VALUES (1), (2)`);
    const before = await runQuery(`SELECT COUNT(*) AS n FROM scratch`);
    expect(before.ok).toBe(true);

    await initTablesDb('/tmp/minerva-tables-test-other');
    const after = await runQuery(`SELECT COUNT(*) AS n FROM scratch`);
    expect(after.ok).toBe(false);
  });
});
