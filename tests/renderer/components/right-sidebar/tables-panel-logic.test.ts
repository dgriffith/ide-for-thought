/**
 * Pure logic for the right-sidebar Tables panel's two-section split (user
 * request): referenced tables (parsed from SQL fences) vs. tables defined in
 * the current note (registered note-source tables). Covers the SQL parsing
 * edge cases and the partition/dedup/search behavior.
 */
import { describe, it, expect } from 'vitest';
import type { TableInfo } from '../../../../src/renderer/lib/ipc/client';
import {
  extractReferencedTableNames,
  partitionTables,
} from '../../../../src/renderer/lib/components/right-sidebar/tables-panel-logic';

function tbl(over: Partial<TableInfo> & { name: string }): TableInfo {
  return {
    relativePath: 'data.csv',
    columns: ['a', 'b'],
    rowCount: 10,
    source: 'csv',
    ...over,
  };
}

describe('extractReferencedTableNames', () => {
  it('pulls FROM / JOIN / INTO targets from sql fences only', () => {
    const md = [
      'Prose that mentions FROM the paragraph should be ignored.',
      '```sql',
      'SELECT * FROM orders JOIN customers ON orders.cid = customers.id',
      '```',
      '```query-table',
      'INSERT INTO audit SELECT * FROM orders',
      '```',
    ].join('\n');
    expect(extractReferencedTableNames(md)).toEqual(['audit', 'customers', 'orders']);
  });

  it('strips quotes and schema prefixes to the bare name', () => {
    const md = '```sql\nSELECT * FROM "My Table" JOIN sales.q1\n```';
    expect(extractReferencedTableNames(md)).toEqual(['My Table', 'q1']);
  });

  it('ignores FROM outside a recognized fence', () => {
    const md = '```python\nx = read("FROM nope")\n```\nInline FROM prose too.';
    expect(extractReferencedTableNames(md)).toEqual([]);
  });

  it('dedupes and sorts', () => {
    const md = '```sql\nSELECT * FROM b; SELECT * FROM a; SELECT * FROM b\n```';
    expect(extractReferencedTableNames(md)).toEqual(['a', 'b']);
  });
});

describe('partitionTables', () => {
  const NOTE = 'notes/report.md';
  const registered = [
    tbl({ name: 'sales', source: 'note', relativePath: NOTE, caption: 'Q1 Sales', tableIndex: 1 }),
    tbl({ name: 'budget', source: 'note', relativePath: NOTE, caption: 'Budget', tableIndex: 0 }),
    tbl({ name: 'other_note_tbl', source: 'note', relativePath: 'notes/elsewhere.md', tableIndex: 0 }),
    tbl({ name: 'people', source: 'csv', relativePath: 'people.csv' }),
  ];

  it('lists this note\'s defined tables, ordered by tableIndex', () => {
    const { defined } = partitionTables('', registered, NOTE, '');
    expect(defined.map((t) => t.name)).toEqual(['budget', 'sales']); // tableIndex 0, then 1
  });

  it('excludes note tables owned by other notes and csv tables from Defined', () => {
    const { defined } = partitionTables('', registered, NOTE, '');
    expect(defined.map((t) => t.name)).not.toContain('other_note_tbl');
    expect(defined.map((t) => t.name)).not.toContain('people');
  });

  it('resolves referenced names to registered info, undefined when unknown', () => {
    const content = '```sql\nSELECT * FROM people JOIN ghost\n```';
    const { referenced } = partitionTables(content, registered, NOTE, '');
    const byName = Object.fromEntries(referenced.map((r) => [r.name, r.info]));
    expect(byName.people?.rowCount).toBe(10);
    expect(byName.ghost).toBeUndefined();
  });

  it('shows a self-defined-and-queried table in BOTH sections', () => {
    const content = '```sql\nSELECT * FROM sales\n```';
    const { defined, referenced } = partitionTables(content, registered, NOTE, '');
    expect(defined.map((t) => t.name)).toContain('sales');
    // Referenced mirrors the SQL — the table isn't hidden just because the
    // note also defines it. Its `info` resolves (it's a registered table).
    const salesRef = referenced.find((r) => r.name === 'sales');
    expect(salesRef?.info?.name).toBe('sales');
  });

  it('applies the search filter to both sections (name and caption)', () => {
    const content = '```sql\nSELECT * FROM people\n```';
    // "sal" matches defined "sales" by name; nothing referenced matches.
    let out = partitionTables(content, registered, NOTE, 'sal');
    expect(out.defined.map((t) => t.name)).toEqual(['sales']);
    expect(out.referenced).toEqual([]);
    // Caption search: "budg" matches the budget table's caption.
    out = partitionTables('', registered, NOTE, 'budg');
    expect(out.defined.map((t) => t.name)).toEqual(['budget']);
    // Referenced search: "peo" matches the referenced people table.
    out = partitionTables(content, registered, NOTE, 'peo');
    expect(out.referenced.map((r) => r.name)).toEqual(['people']);
  });

  it('with no active note, Defined is empty and everything is Referenced', () => {
    const content = '```sql\nSELECT * FROM sales\n```';
    const { defined, referenced } = partitionTables(content, registered, null, '');
    expect(defined).toEqual([]);
    expect(referenced.map((r) => r.name)).toEqual(['sales']);
  });
});
