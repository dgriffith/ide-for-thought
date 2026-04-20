import { describe, it, expect } from 'vitest';
import { parseCsv } from '../../src/shared/csv-parse';

describe('parseCsv (issue #199)', () => {
  it('parses a simple header + rows', () => {
    const r = parseCsv('name,count\nalice,3\nbob,5');
    expect(r.hadHeaderRow).toBe(true);
    expect(r.headers).toEqual(['name', 'count']);
    expect(r.rows).toEqual([['alice', '3'], ['bob', '5']]);
  });

  it('tolerates a trailing newline', () => {
    const r = parseCsv('a,b\n1,2\n');
    expect(r.rows).toEqual([['1', '2']]);
  });

  it('handles quoted fields with embedded commas', () => {
    const r = parseCsv('name,desc\nalice,"hello, world"\n');
    expect(r.rows).toEqual([['alice', 'hello, world']]);
  });

  it('handles quoted fields with embedded newlines', () => {
    const r = parseCsv('name,note\nalice,"line 1\nline 2"\n');
    expect(r.rows).toEqual([['alice', 'line 1\nline 2']]);
  });

  it('decodes doubled quotes as a single literal quote', () => {
    const r = parseCsv('name,quote\nbob,"she said ""hi"""');
    expect(r.rows).toEqual([['bob', 'she said "hi"']]);
  });

  it('treats CRLF and LF equivalently as record separators', () => {
    const r = parseCsv('a,b\r\n1,2\r\n3,4');
    expect(r.rows).toEqual([['1', '2'], ['3', '4']]);
  });

  it('strips a leading BOM', () => {
    const r = parseCsv('\uFEFFname,count\nalice,3');
    expect(r.headers).toEqual(['name', 'count']);
  });

  it('synthesizes col_N headers when the first row looks numeric', () => {
    const r = parseCsv('1,2,3\n4,5,6');
    expect(r.hadHeaderRow).toBe(false);
    expect(r.headers).toEqual(['col_1', 'col_2', 'col_3']);
    expect(r.rows).toEqual([['1', '2', '3'], ['4', '5', '6']]);
  });

  it('synthesizes col_N headers when the first row contains an empty cell', () => {
    const r = parseCsv('name,,value\nalice,foo,3');
    expect(r.hadHeaderRow).toBe(false);
    expect(r.headers).toEqual(['col_1', 'col_2', 'col_3']);
    expect(r.rows[0]).toEqual(['name', '', 'value']);
  });

  it('pads short rows and trims long rows to the header width', () => {
    const r = parseCsv('a,b,c\n1,2\n4,5,6,7');
    expect(r.rows).toEqual([
      ['1', '2', ''],
      ['4', '5', '6'],
    ]);
  });

  it('returns empty headers + rows for an empty file', () => {
    expect(parseCsv('')).toEqual({ headers: [], rows: [], hadHeaderRow: false });
    expect(parseCsv('\n\n\n')).toEqual({ headers: [], rows: [], hadHeaderRow: false });
  });

  it('preserves whitespace inside fields verbatim', () => {
    const r = parseCsv('a,b\n  spaced  ,  also  ');
    expect(r.rows).toEqual([['  spaced  ', '  also  ']]);
  });
});
