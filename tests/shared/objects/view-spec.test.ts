/**
 * A view's folder scope and filters (#2531): the one function the panel, an
 * embed and an export all apply.
 */
import { describe, it, expect } from 'vitest';
import { applyViewSpec, inFolder, normalizeFolder, parseViewFilters } from '../../../src/shared/objects/view-spec';
import type { TypeInstanceRow } from '../../../src/shared/objects/type-def';

const row = (path: string, values: Record<string, string | null>): TypeInstanceRow => ({ path, title: path, values, cover: null });
const PLACES = [
  row('trip/prague/Kampa.md', { city: 'Prague', rating: '5', visited: '2026-05-14' }),
  row('trip/prague/Petrin.md', { city: 'Prague', rating: '3', visited: null }),
  row('trip/budapest/Szechenyi.md', { city: 'Budapest', rating: '4', visited: '2026-06-02' }),
  row('tripod/Odd.md', { city: 'Brno', rating: '9', visited: '2026-04-01' }),
  row('Top.md', { city: null, rating: 'n/a', visited: '2026-05' }),
];
const TYPES = { city: 'text', rating: 'number', visited: 'date' } as const;
const paths = (scope: Parameters<typeof applyViewSpec>[1]) => applyViewSpec(PLACES, scope, TYPES).map((r) => r.path);

describe('folder scope', () => {
  it('is recursive, and matched on path segments', () => {
    expect(paths({ folder: 'trip' })).toEqual(['trip/prague/Kampa.md', 'trip/prague/Petrin.md', 'trip/budapest/Szechenyi.md']);
    expect(paths({ folder: 'trip/prague' })).toEqual(['trip/prague/Kampa.md', 'trip/prague/Petrin.md']);
  });
  it('normalizes slashes; empty or root means everything', () => {
    expect(normalizeFolder('/trip/prague/')).toBe('trip/prague');
    expect(normalizeFolder('')).toBeNull();
    expect(normalizeFolder('.')).toBeNull();
    expect(paths({ folder: null })).toHaveLength(5);
    expect(inFolder('Top.md', '')).toBe(true);
  });
});

describe('filters', () => {
  it('values: one of the listed values; an empty value never passes', () => {
    expect(paths({ filters: [{ property: 'city', values: ['Prague', 'Brno'] }] })).toEqual(['trip/prague/Kampa.md', 'trip/prague/Petrin.md', 'tripod/Odd.md']);
  });

  it('number range: numeric, inclusive; non-numbers never pass', () => {
    expect(paths({ filters: [{ property: 'rating', min: '4' }] })).toEqual(['trip/prague/Kampa.md', 'trip/budapest/Szechenyi.md', 'tripod/Odd.md']);
    expect(paths({ filters: [{ property: 'rating', min: '3', max: '4' }] })).toEqual(['trip/prague/Petrin.md', 'trip/budapest/Szechenyi.md']);
    expect(paths({ filters: [{ property: 'rating', max: '10' }] })).not.toContain('Top.md'); // 'n/a'
  });

  it('date range: by ISO order, a month bound covering the whole month', () => {
    expect(paths({ filters: [{ property: 'visited', min: '2026-05', max: '2026-05' }] })).toEqual(['trip/prague/Kampa.md', 'Top.md']);
    expect(paths({ filters: [{ property: 'visited', min: '2026-05-15' }] })).toEqual(['trip/budapest/Szechenyi.md']);
  });

  it('combine with AND, and with the folder', () => {
    expect(paths({ folder: 'trip', filters: [{ property: 'city', values: ['Prague'] }, { property: 'rating', min: '4' }] })).toEqual(['trip/prague/Kampa.md']);
  });

  it('keep the original order', () => {
    expect(paths({ filters: [{ property: 'city', values: ['Budapest', 'Prague'] }] })).toEqual(['trip/prague/Kampa.md', 'trip/prague/Petrin.md', 'trip/budapest/Szechenyi.md']);
  });
});

describe('parseViewFilters', () => {
  it('keeps well-formed filters and drops the rest', () => {
    expect(parseViewFilters([
      { property: 'city', values: ['Prague', 3] },
      { property: 'rating', min: '4', max: '' },
      { property: 'city', values: [] },
      { property: '', values: ['x'] },
      { property: 'rating' },
      'junk',
    ])).toEqual([
      { property: 'city', values: ['Prague'] },
      { property: 'rating', min: '4', max: null },
    ]);
    expect(parseViewFilters('nope')).toEqual([]);
  });
});
