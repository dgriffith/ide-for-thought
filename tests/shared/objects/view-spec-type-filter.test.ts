/**
 * The Type filter (#2716): a values filter on the reserved key `type`, over
 * the view type's subtypes, matched hierarchically through `inheritsFrom`.
 */
import { describe, it, expect } from 'vitest';
import {
  applyViewSpec, matchesFilter, parseViewFilters, resolveTypeFilter, type TypeLookup,
} from '../../../src/shared/objects/view-spec';
import { subtypeChoices } from '../../../src/shared/objects/type-filter';
import type { TypeInstanceRow } from '../../../src/shared/objects/type-def';

const CATALOG = [
  { id: 'place', label: 'Place' },
  { id: 'restaurant', label: 'Restaurant', parent: 'place', icon: '🍽' },
  { id: 'pizzeria', label: 'Pizzeria', parent: 'restaurant' },
  { id: 'museum', label: 'Museum', parent: 'place' },
  { id: 'book', label: 'Book' },
];
const row = (path: string, city: string | null, type?: string): TypeInstanceRow =>
  // A literal `type` value in `values` must never be what a type filter reads.
  ({ path, title: path, values: { city, ...(type ? { type } : {}) }, cover: null });
const OWN: Record<string, string> = {
  'Luigi.md': 'pizzeria', 'Bistro.md': 'restaurant', 'Louvre.md': 'museum', 'Park.md': 'place', 'Kampa.md': 'restaurant',
};
const INSTANCES = [
  row('Luigi.md', 'Prague'), row('Bistro.md', 'Paris'), row('Louvre.md', 'Paris', 'restaurant'),
  row('Park.md', 'Prague', 'restaurant'), row('Kampa.md', 'Prague'),
];
const LOOKUP: TypeLookup = { byId: new Map(CATALOG.map((t) => [t.id, t])), typeOf: (p) => OWN[p] ?? null };
const paths = (filters: Parameters<typeof applyViewSpec>[1]['filters'], lookup: TypeLookup | null = LOOKUP) =>
  applyViewSpec(INSTANCES, { filters }, { city: 'text' }, lookup).map((r) => r.path);

describe('the Type filter (#2716)', () => {
  it('Restaurant keeps Restaurants and Pizzerias, and drops Museums and plain Places', () => {
    expect(paths([{ property: 'type', values: ['restaurant'] }])).toEqual(['Luigi.md', 'Bistro.md', 'Kampa.md']);
  });

  it('is an OR within the filter, and an AND with a property filter', () => {
    expect(paths([{ property: 'type', values: ['pizzeria', 'museum'] }])).toEqual(['Luigi.md', 'Louvre.md']);
    expect(paths([{ property: 'type', values: ['restaurant'] }, { property: 'city', values: ['Prague'] }])).toEqual(['Luigi.md', 'Kampa.md']);
  });

  it('never falls through to matching a literal `type` value as a string', () => {
    // Louvre and Park carry `type: restaurant` in their values; neither is one.
    expect(paths([{ property: 'type', values: ['restaurant'] }])).not.toContain('Louvre.md');
    expect(paths([{ property: 'type', values: ['restaurant'] }])).not.toContain('Park.md');
    // Without the catalog a type filter keeps nothing — not the string match.
    expect(paths([{ property: 'type', values: ['restaurant'] }], null)).toEqual([]);
    expect(matchesFilter(INSTANCES[2]!, { property: 'type', values: ['restaurant'] }, 'text')).toBe(false);
  });

  it('drops a stale id — deleted, renamed, the view type itself or not a subtype — once the catalog is known', () => {
    const filters = [{ property: 'type', values: ['restaurant', 'gone', 'place', 'book'] }, { property: 'city', values: ['Paris'] }];
    expect(resolveTypeFilter(filters, 'place', LOOKUP.byId)).toEqual([
      { property: 'type', values: ['restaurant'] }, { property: 'city', values: ['Paris'] },
    ]);
    // Nothing left → the whole filter goes, so the view is unfiltered by type.
    expect(resolveTypeFilter([{ property: 'type', values: ['gone'] }], 'place', LOOKUP.byId)).toEqual([]);
    // An unknown catalog changes nothing.
    expect(resolveTypeFilter(filters, 'place', null)).toEqual(filters);
  });

  it('parses only as a values filter', () => {
    expect(parseViewFilters([{ property: 'type', values: ['restaurant'] }, { property: 'type', min: 'a' }]))
      .toEqual([{ property: 'type', values: ['restaurant'] }]);
  });
});

describe('subtypeChoices (#2716)', () => {
  it('is the view type\'s subtypes as a tree, by label, with counts in scope', () => {
    expect(subtypeChoices('place', CATALOG, INSTANCES, LOOKUP.typeOf)).toEqual([
      { id: 'museum', label: 'Museum', icon: undefined, depth: 0, count: 1 },
      { id: 'restaurant', label: 'Restaurant', icon: '🍽', depth: 0, count: 3 },
      { id: 'pizzeria', label: 'Pizzeria', icon: undefined, depth: 1, count: 1 },
    ]);
    const prague = INSTANCES.filter((i) => i.values.city === 'Prague');
    expect(subtypeChoices('place', CATALOG, prague, LOOKUP.typeOf).map((c) => c.count)).toEqual([0, 2, 1]);
  });

  it('is empty for a type with no subtypes, and survives a cycle', () => {
    expect(subtypeChoices('book', CATALOG, INSTANCES, LOOKUP.typeOf)).toEqual([]);
    const cyclic = [{ id: 'a', parent: 'b' }, { id: 'b', parent: 'a' }];
    expect(subtypeChoices('a', cyclic, [], () => null).map((c) => c.id)).toEqual(['b']);
  });
});
