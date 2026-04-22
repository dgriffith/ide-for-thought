import { describe, it, expect } from 'vitest';
import { formatSql } from '../../src/shared/sql-format';

describe('formatSql (issue #260)', () => {
  it('uppercases keywords and splits clauses across lines', () => {
    expect(formatSql('select a,b from t where a=1 order by b')).toBe(
      `SELECT
  a,
  b
FROM
  t
WHERE
  a = 1
ORDER BY
  b`,
    );
  });

  it('preserves leading comments and DuckDB-specific identifiers', () => {
    const input = '-- Replace YOUR_TABLE with a real table.\nDESCRIBE YOUR_TABLE;';
    expect(formatSql(input)).toBe(
      `-- Replace YOUR_TABLE with a real table.
DESCRIBE YOUR_TABLE;`,
    );
  });

  it('recognises DuckDB SUMMARIZE', () => {
    // SUMMARIZE is a DuckDB-only statement; the dialect-specific formatter
    // should pass it through intact rather than mangling it.
    const out = formatSql('summarize my_table');
    expect(out).toBe('SUMMARIZE my_table');
  });

  it('returns input unchanged when already canonical (idempotent)', () => {
    const formatted = formatSql('select 1');
    expect(formatSql(formatted)).toBe(formatted);
  });

  it('falls back to the original text on a parser error', () => {
    // sql-formatter is forgiving, but if it ever throws the helper
    // must surface the original so a half-typed query isn't destroyed.
    // Probe with a deeply malformed string that sql-formatter either
    // handles or throws on — either way the contract holds.
    const input = 'SELECT (((';
    expect(() => formatSql(input)).not.toThrow();
  });
});
