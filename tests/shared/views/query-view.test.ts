/**
 * A query view's column types and note column, inferred from values
 * (#2944): each rule in order, overrides, and the note column's choice.
 */
import { describe, it, expect } from 'vitest';
import { ENUM_MAX_OPTIONS, inferColumnType, parseColumnOverrides, pickNoteColumn } from '../../../src/shared/views/query-view';

const NOTES = new Set(['a.md', 'b.md']);
const isNote = (v: string) => NOTES.has(v);
const infer = (values: (string | null)[]) => inferColumnType(values, isNote);

describe('inferColumnType', () => {
  it('each kind, over every non-empty value', () => {
    expect(infer(['a.md', null, 'b.md'])).toEqual({ type: 'link-to-type' });
    expect(infer(['true', 'false'])).toEqual({ type: 'boolean' });
    expect(infer(['50.08, 14.42', '48.2,16.37'])).toEqual({ type: 'geo' });
    expect(infer(['2026-10-07', '2026-10'])).toEqual({ type: 'date' });
    expect(infer(['2026-10-07T09:00', '2026-10-08'])).toEqual({ type: 'datetime' });
    expect(infer(['1', '2.5', '-3e2'])).toEqual({ type: 'number' });
    expect(infer(['todo', 'done', 'todo'])).toEqual({ type: 'enum', options: ['todo', 'done'] });
    expect(infer(['Ann', 'Bo', 'Cy'])).toEqual({ type: 'text' }); // nothing repeats
  });

  it('a column of bare years is numbers; an empty column is text; whitespace is ignored', () => {
    expect(infer(['1969', '2026'])).toEqual({ type: 'number' });
    expect(infer([null, ''])).toEqual({ type: 'text' });
    expect(infer([' 3 ', '4'])).toEqual({ type: 'number' });
  });

  it(`more than ${ENUM_MAX_OPTIONS} distinct values, or a single row, is text`, () => {
    const many = Array.from({ length: ENUM_MAX_OPTIONS + 1 }, (_, i) => `v${i}`);
    expect(infer([...many, ...many])).toEqual({ type: 'text' });
    expect(infer(['todo'])).toEqual({ type: 'text' });
  });
});

describe('parseColumnOverrides', () => {
  it('reads name:type pairs and drops an unknown type', () => {
    expect(parseColumnOverrides(' due:date, status : enum, x:nonsense, :text, y')).toEqual({ due: 'date', status: 'enum' });
    expect(parseColumnOverrides(undefined)).toEqual({});
  });
});

describe('pickNoteColumn', () => {
  const rows = [{ t: 'a.md', who: 'b.md', n: '1' }, { t: 'b.md', who: null, n: '2' }];
  it('the preferred column when present, else the first whose every value is a note', () => {
    expect(pickNoteColumn(['n', 't', 'who'], rows, isNote)).toBe('t');
    expect(pickNoteColumn(['n', 't', 'who'], rows, isNote, 'who')).toBe('who');
    expect(pickNoteColumn(['n', 't', 'who'], rows, isNote, 'missing')).toBe('t');
    expect(pickNoteColumn(['n'], rows, isNote)).toBeNull();
    expect(pickNoteColumn(['t'], [], isNote)).toBeNull();
  });
});
