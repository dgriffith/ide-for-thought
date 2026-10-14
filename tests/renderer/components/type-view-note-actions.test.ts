/**
 * What a view's row menu lists for a selection (#2773).
 */
import { describe, it, expect } from 'vitest';
import { selectionSetProperties, selectionTags } from '../../../src/renderer/lib/components/type-view/note-actions';
import type { TypeInstanceRow } from '../../../src/shared/objects/type-def';

const rows: TypeInstanceRow[] = [
  { path: 'a.md', title: 'A', values: { city: 'Prague', rating: '' }, cover: null, tags: ['#Work', 'ml/nlp'] },
  { path: 'b.md', title: 'B', values: { city: null, rating: '4' }, cover: null, tags: ['work'] },
  { path: 'c.md', title: 'C', values: { city: 'Brno', rating: '5' }, cover: null },
];
const PROPS = [{ name: 'city', type: 'text' as const, label: 'City' }, { name: 'rating', type: 'number' as const }];

describe('selectionTags', () => {
  it('folds by case and `#`, counts notes, and covers only the selection', () => {
    expect(selectionTags(rows, ['a.md', 'b.md'])).toEqual([
      { key: 'ml/nlp', label: '#ml/nlp', count: 1 },
      { key: 'Work', label: '#Work', count: 2 },
    ]);
    expect(selectionTags(rows, ['c.md'])).toEqual([]);
  });
});

describe('selectionSetProperties', () => {
  it('lists the properties the selection has set, with counts; empty strings don\'t count', () => {
    expect(selectionSetProperties(rows, ['a.md', 'b.md'], PROPS)).toEqual([
      { key: 'city', label: 'City', count: 1 },
      { key: 'rating', label: 'rating', count: 1 },
    ]);
  });
});
