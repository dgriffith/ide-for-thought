/**
 * The hint appended to SQL the file lockdown refused (#2437).
 */
import { describe, it, expect } from 'vitest';
import { withSqlAccessHint, SQL_OUTSIDE_ROOT_HINT } from '../../src/shared/sql-access-hint';

// Verbatim DuckDB 1.5.3 refusals, first line plus the caret context it appends.
const FILE_REFUSAL =
  'Permission Error: Cannot access file "/Users/me/Downloads/x.csv" - file system operations are disabled by configuration\n' +
  "LINE 1: SELECT * FROM read_csv('/Users/me/Downloads/x.csv')\n" +
  '                      ^';
const DIR_REFUSAL =
  'Permission Error: Cannot access directory "/Users/me/.duckdb/extensions/v1.5.3/osx_arm64" - file system operations are disabled by configuration';

describe('withSqlAccessHint', () => {
  it('appends the hint to a file-access refusal, keeping the original message first', () => {
    const out = withSqlAccessHint(FILE_REFUSAL);
    expect(out.startsWith(FILE_REFUSAL)).toBe(true);
    expect(out.endsWith(SQL_OUTSIDE_ROOT_HINT)).toBe(true);
  });

  it('also covers a directory refusal', () => {
    expect(withSqlAccessHint(DIR_REFUSAL)).toContain(SQL_OUTSIDE_ROOT_HINT);
  });

  it('points at copying the file in or a Python cell, not at a setting', () => {
    expect(SQL_OUTSIDE_ROOT_HINT).toMatch(/inside this thoughtbase/);
    expect(SQL_OUTSIDE_ROOT_HINT).toMatch(/Python cell/);
    expect(SQL_OUTSIDE_ROOT_HINT).not.toMatch(/Settings/i);
  });

  it('leaves every other error alone', () => {
    for (const e of [
      'Parser Error: syntax error at or near "SELEKT"',
      'Catalog Error: Table with name nope does not exist!',
      'Invalid Input Error: Cannot change configuration option "enable_external_access" - the configuration has been locked',
      'Permission Error: Loading external extensions is disabled through configuration',
      '',
    ]) {
      expect(withSqlAccessHint(e)).toBe(e);
    }
  });

  it('is idempotent', () => {
    const once = withSqlAccessHint(FILE_REFUSAL);
    expect(withSqlAccessHint(once)).toBe(once);
  });
});
