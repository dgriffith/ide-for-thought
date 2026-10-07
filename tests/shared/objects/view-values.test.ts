/**
 * How a type view shows, sorts and exports property values (#2613's
 * `datetime` among them).
 */
import { describe, it, expect } from 'vitest';
import { comparePropertyValues, viewToCsv } from '../../../src/shared/objects/view-values';
import { displayPropertyValue } from '../../../src/shared/objects/property-display';
import { parseCsv } from '../../../src/shared/csv-parse';
import type { PropertyDef, TypeInstanceRow } from '../../../src/shared/objects/type-def';

const en = { locale: 'en-US', zoneOffsetMinutes: () => 0 };
const plain = (s: string) => s.replace(/\u202f/g, ' ');

describe('displayPropertyValue', () => {
  it('shows a datetime locale-formatted, with the time only when the value has one', () => {
    const dt = { type: 'datetime' } as const;
    expect(plain(displayPropertyValue(dt, '2026-10-05T14:30:00', en))).toBe('Oct 5, 2026, 2:30 PM');
    expect(displayPropertyValue(dt, '2026-10-05', en)).toBe('Oct 5, 2026');
    expect(displayPropertyValue(dt, '2026-10', en)).toBe('Oct 2026');
    expect(displayPropertyValue(dt, '1969', en)).toBe('1969');
    expect(displayPropertyValue(dt, '-0043', en)).toBe('44 BC');
    expect(displayPropertyValue(dt, 'tbd', en)).toBe('tbd');
  });

  it('leaves a date as written, a link as its target\'s name, and empty as a dash', () => {
    expect(displayPropertyValue({ type: 'date' }, '2026-10-05')).toBe('2026-10-05');
    expect(displayPropertyValue({ type: 'link-to-type' }, 'https://x.test/note/Ada%20Lovelace')).toBe('Ada Lovelace');
    expect(displayPropertyValue({ type: 'datetime' }, null)).toBe('—');
    expect(displayPropertyValue({ type: 'text' }, '')).toBe('—');
  });
});

describe('comparePropertyValues — sorting', () => {
  const sort = (type: PropertyDef['type'], values: string[]) => [...values].sort((a, b) => comparePropertyValues(type, a, b));

  it('sorts datetime and date by parsed span, not by string', () => {
    const values = ['2026-10-05T14:30:00', '12026', '2026-10-05T09:00:00', '-0043', '2026-10-05', '0044'];
    const expected = ['-0043', '0044', '2026-10-05', '2026-10-05T09:00:00', '2026-10-05T14:30:00', '12026'];
    expect(sort('datetime', values)).toEqual(expected);
    expect(sort('date', values)).toEqual(expected);
  });

  it('sorts numbers numerically and text naturally', () => {
    expect(sort('number', ['10', '9', '-1'])).toEqual(['-1', '9', '10']);
    expect(sort('text', ['b10', 'B2', 'a'])).toEqual(['a', 'B2', 'b10']);
  });
});

describe('viewToCsv', () => {
  const cols: PropertyDef[] = [
    { name: 'date', type: 'datetime', label: 'Starts' },
    { name: 'where', type: 'link-to-type' },
    { name: 'note', type: 'text' },
  ];
  const rows: TypeInstanceRow[] = [
    { path: 'a.md', title: 'Launch, day one', values: { date: '2026-10-05T14:30:00+02:00', where: 'https://x.test/note/Prague', note: 'say "hi"' }, cover: null },
    { path: 'b.md', title: 'Ides', values: { date: '-0043-03-15', where: null, note: null }, cover: null },
  ];

  it('writes a Title column and the given columns, with ISO date values, quoting as CSV needs', () => {
    const csv = viewToCsv(cols, rows);
    expect(csv.split('\n')[0]).toBe('Title,Starts,where,note');
    expect(parseCsv(csv).rows).toEqual([
      ['Launch, day one', '2026-10-05T14:30:00+02:00', 'Prague', 'say "hi"'],
      ['Ides', '-0043-03-15', '', ''],
    ]);
  });
});
