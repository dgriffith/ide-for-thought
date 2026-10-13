/**
 * The tags filter (#2768): the reserved `tags` key keeps a note by its tags —
 * any, all or none of the listed ones — where a tag covers itself and every
 * tag nested under it, compared case-insensitively without the `#`.
 */
import { describe, it, expect } from 'vitest';
import { applyViewSpec, parseViewFilters, tagCovers, type ValuesFilter } from '../../../src/shared/objects/view-spec';
import type { TypeInstanceRow } from '../../../src/shared/objects/type-def';

const row = (path: string, tags?: string[]): TypeInstanceRow => ({ path, title: path, values: {}, cover: null, ...(tags ? { tags } : {}) });
const tags = (values: string[], match?: ValuesFilter['match']): ValuesFilter => ({ property: 'tags', values, ...(match ? { match } : {}) });
const ROWS = [
  row('active.md', ['active']),
  row('ml.md', ['ml/nlp', 'Work']),
  row('both.md', ['active', 'work']),
  row('archived.md', ['archived/2025']),
  row('none.md', []),
  row('unknown.md'), // tags not known — treated as none
];
const kept = (f: ValuesFilter) => applyViewSpec(ROWS, { filters: [f] }).map((r) => r.path);

describe('tagCovers', () => {
  it('covers itself and what is nested under it, nothing else', () => {
    expect(tagCovers('ml', 'ml')).toBe(true);
    expect(tagCovers('ml', 'ml/nlp')).toBe(true);
    expect(tagCovers('ml', 'mlops')).toBe(false);
    expect(tagCovers('ml/nlp', 'ml')).toBe(false);
  });

  it('ignores case and a leading #', () => {
    expect(tagCovers('#Work', 'work')).toBe(true);
    expect(tagCovers('work', '#WORK')).toBe(true);
  });
});

describe('matching', () => {
  it('any (the default): at least one', () => {
    expect(kept(tags(['active', 'ml']))).toEqual(['active.md', 'ml.md', 'both.md']);
  });

  it('all: every one', () => {
    expect(kept(tags(['active', 'work'], 'all'))).toEqual(['both.md']);
  });

  it('none: none of them — nested tags included, untagged notes kept', () => {
    expect(kept(tags(['archived'], 'none'))).toEqual(['active.md', 'ml.md', 'both.md', 'none.md', 'unknown.md']);
  });

  it('ANDs with the other filters', () => {
    const rows = [
      { ...row('p1.md', ['work']), values: { city: 'Prague' } },
      { ...row('p2.md', ['home']), values: { city: 'Prague' } },
      { ...row('b1.md', ['work']), values: { city: 'Brno' } },
    ];
    const filters = [tags(['work']), { property: 'city', values: ['Prague'] }];
    expect(applyViewSpec(rows, { filters }).map((r) => r.path)).toEqual(['p1.md']);
  });
});

describe('parseViewFilters', () => {
  it('keeps a tags filter and how its tags combine', () => {
    expect(parseViewFilters([{ property: 'tags', values: ['a'], match: 'none' }])).toEqual([tags(['a'], 'none')]);
  });

  it('leaves the default `any` out, and drops an unknown match', () => {
    expect(parseViewFilters([{ property: 'tags', values: ['a'], match: 'any' }])).toEqual([tags(['a'])]);
    expect(parseViewFilters([{ property: 'tags', values: ['a'], match: 'some' }])).toEqual([tags(['a'])]);
  });

  it('never makes a tags range, and ignores match on any other key', () => {
    expect(parseViewFilters([{ property: 'tags', min: '1' }])).toEqual([]);
    expect(parseViewFilters([{ property: 'city', values: ['Prague'], match: 'none' }])).toEqual([{ property: 'city', values: ['Prague'] }]);
  });
});
