import { describe, it, expect } from 'vitest';
import { citekeyStem, assignCitekeys } from '../../../src/main/publish/citekey';
import type { CslItem } from '../../../src/main/publish/csl/source-to-csl';

function item(over: Partial<CslItem> & { id: string }): CslItem {
  return { type: 'article-journal', ...over };
}

describe('citekeyStem (#114, #115)', () => {
  it('builds author-year-firstword from full metadata', () => {
    expect(
      citekeyStem(
        item({
          id: 'doi-1',
          author: [{ family: 'Brooks', given: 'Frederick P.' }],
          issued: { 'date-parts': [[1987]] },
          title: 'No Silver Bullet — Essence and Accident',
        }),
      ),
    ).toBe('brooks-1987-no');
  });

  it('skips leading stopwords when picking the first title word', () => {
    // "The Mythical Man-Month" → first non-stopword is "mythical".
    expect(
      citekeyStem(
        item({
          id: 'b-1',
          author: [{ family: 'Brooks' }],
          issued: { 'date-parts': [[1975]] },
          title: 'The Mythical Man-Month',
        }),
      ),
    ).toBe('brooks-1975-mythical');
  });

  it('takes only the trailing token of multi-word family names', () => {
    expect(
      citekeyStem(
        item({
          id: 'b-1',
          author: [{ family: 'van der Berg' }],
          issued: { 'date-parts': [[2020]] },
          title: 'A Study',
        }),
      ),
    ).toBe('berg-2020-study');
  });

  it('ASCII-folds diacritics', () => {
    expect(
      citekeyStem(
        item({
          id: 'b-1',
          author: [{ family: 'Pérez' }],
          issued: { 'date-parts': [[2020]] },
          title: 'Étude',
        }),
      ),
    ).toBe('perez-2020-etude');
  });

  it('falls back to anon / nodate / no-title gracefully', () => {
    expect(citekeyStem(item({ id: 'x' }))).toBe('anon-nodate');
    expect(
      citekeyStem(item({ id: 'x', author: [{ family: 'Smith' }] })),
    ).toBe('smith-nodate');
    expect(
      citekeyStem(
        item({ id: 'x', author: [{ family: 'Smith' }], issued: { 'date-parts': [[2020]] } }),
      ),
    ).toBe('smith-2020');
  });

  it('handles institutional / literal authors', () => {
    expect(
      citekeyStem(
        item({
          id: 'x',
          author: [{ literal: 'World Health Organization' }],
          issued: { 'date-parts': [[2020]] },
          title: 'Report',
        }),
      ),
    ).toBe('organization-2020-report');
  });
});

describe('assignCitekeys (#114, #115)', () => {
  it('returns the bare stem when only one item shares it', () => {
    const items: CslItem[] = [
      item({
        id: 'a',
        author: [{ family: 'Smith' }],
        issued: { 'date-parts': [[2020]] },
        title: 'Paper',
      }),
    ];
    const map = assignCitekeys(items);
    expect(map.get('a')).toBe('smith-2020-paper');
  });

  it('appends a/b/c suffixes for collisions, ordered by source id', () => {
    const items: CslItem[] = [
      item({
        id: 'doi-z',
        author: [{ family: 'Smith' }],
        issued: { 'date-parts': [[2020]] },
        title: 'Paper One',
      }),
      item({
        id: 'doi-a',
        author: [{ family: 'Smith' }],
        issued: { 'date-parts': [[2020]] },
        title: 'Paper Two',
      }),
    ];
    const map = assignCitekeys(items);
    // Sorted by id: 'doi-a' first → 'a', 'doi-z' second → 'b'.
    expect(map.get('doi-a')).toBe('smith-2020-papera');
    expect(map.get('doi-z')).toBe('smith-2020-paperb');
  });

  it('is deterministic across input orderings (stable per export)', () => {
    const a: CslItem = item({
      id: 'doi-a',
      author: [{ family: 'Smith' }],
      issued: { 'date-parts': [[2020]] },
      title: 'P',
    });
    const b: CslItem = item({
      id: 'doi-b',
      author: [{ family: 'Smith' }],
      issued: { 'date-parts': [[2020]] },
      title: 'P',
    });
    const map1 = assignCitekeys([a, b]);
    const map2 = assignCitekeys([b, a]);
    expect(map1.get('doi-a')).toBe(map2.get('doi-a'));
    expect(map1.get('doi-b')).toBe(map2.get('doi-b'));
  });
});
