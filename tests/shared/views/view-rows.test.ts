/**
 * A query view's rows as layouts draw them (#2946): every row kept for a
 * table (repeats keyed apart), rows with no note under a synthetic path, and
 * one card per note for the card layouts, multi-valued columns joined.
 */
import { describe, it, expect } from 'vitest';
import { mergeRowsByNote, NO_NOTE_PREFIX, toViewRows } from '../../../src/shared/views/view-rows';

const ROWS = [
  { path: 'a.md', title: 'A', values: { tag: 'red', due: '2026-10-07' }, tags: ['x'] },
  { path: 'b.md', title: 'B', values: { tag: 'blue', due: null } },
  { path: 'a.md', title: 'A', values: { tag: 'green', due: '2026-10-07' }, tags: ['y'] },
  { path: null, title: 'loose', values: { tag: 'red', due: null } },
  { path: 'a.md', title: 'A', values: { tag: 'red', due: '2026-10-08' } },
];

describe('toViewRows (#2946)', () => {
  it('keeps every row: a repeated note gets a key of its own, a row with no note a synthetic path', () => {
    const rows = toViewRows(ROWS);
    expect(rows.map((r) => [r.path, r.key ?? null, r.noNote ?? false])).toEqual([
      ['a.md', null, false], ['b.md', null, false], ['a.md', 'a.md#2', false], [`${NO_NOTE_PREFIX}3`, null, true], ['a.md', 'a.md#3', false],
    ]);
    expect(new Set(rows.map((r) => r.key ?? r.path)).size).toBe(5); // unique, for the layouts' keyed lists
    expect(rows[3]).toMatchObject({ title: 'loose', values: { tag: 'red' }, cover: null });
  });
});

describe('mergeRowsByNote (#2946)', () => {
  it('one row per note, first-seen order, distinct values joined; rows with no note stay', () => {
    const merged = mergeRowsByNote(toViewRows(ROWS));
    expect(merged.map((r) => r.path)).toEqual(['a.md', 'b.md', `${NO_NOTE_PREFIX}3`]);
    expect(merged[0]).toMatchObject({ values: { tag: 'red, green', due: '2026-10-07, 2026-10-08' }, tags: ['x', 'y'] });
    expect(merged[0]).not.toHaveProperty('key');
    expect(merged[1]!.values).toEqual({ tag: 'blue', due: null });
  });

  it('changes nothing for rows that never repeat', () => {
    const once = toViewRows([ROWS[0]!, ROWS[1]!]);
    expect(mergeRowsByNote(once)).toEqual(once);
  });
});
