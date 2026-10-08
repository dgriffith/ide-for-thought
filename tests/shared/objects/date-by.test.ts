/**
 * *Date by* (#2701): the ONE view-spec field Calendar and Timeline (#2715)
 * both read — its choices, default, untrusted parse,
 * validation against the type, and Event's end convention (Decisions 1 and 2
 * of the design story #2700).
 */
import { describe, it, expect } from 'vitest';
import {
  dateByChoices, dateByForSpec, dateProperties, defaultDateBy, endPropertyFor, hasDateProperty, isDateProperty, parseDateBy, resolveDateBy,
} from '../../../src/shared/objects/date-by';
import type { PropertyDef } from '../../../src/shared/objects/type-def';
import { settledPropertyDefs } from '../../../src/shared/objects/inheritance';

const p = (name: string, type: PropertyDef['type']): PropertyDef => ({ name, type });
const EVENT = [p('date', 'datetime'), p('end', 'datetime'), p('location', 'link-to-type')];
const BOOK = [p('author', 'text'), p('published', 'date'), p('rating', 'number')];
const TRIP = [p('city', 'text'), p('departs', 'date'), p('returns', 'datetime')];
const TASK = [p('due', 'date'), p('date', 'date')]; // `date` declared second still wins the default
const ENDS_ONLY = [p('end', 'date'), p('started', 'date')]; // `end` with no `date` is an ordinary date
const RECIPE = [p('serves', 'number'), p('cuisine', 'enum')];
const names = (ps: PropertyDef[]) => ps.map((x) => x.name);

describe('date properties and choices (#2701)', () => {
  it('a date property is a `date` or a `datetime`, in declaration order', () => {
    expect(isDateProperty(p('d', 'date'))).toBe(true);
    expect(isDateProperty(p('d', 'datetime'))).toBe(true);
    expect(isDateProperty(p('d', 'text'))).toBe(false);
    expect(names(dateProperties(TRIP))).toEqual(['departs', 'returns']);
    expect(dateProperties(RECIPE)).toEqual([]);
  });

  it('offers every date property, less `end` when the type also has `date`', () => {
    expect(names(dateByChoices(EVENT))).toEqual(['date']);
    expect(names(dateByChoices(BOOK))).toEqual(['published']);
    expect(names(dateByChoices(TRIP))).toEqual(['departs', 'returns']);
    expect(names(dateByChoices(ENDS_ONLY))).toEqual(['end', 'started']);
    expect(dateByChoices(RECIPE)).toEqual([]);
  });
});

describe('defaultDateBy (#2701)', () => {
  it('is `date` if the type has it, else the first date property, else null', () => {
    expect(defaultDateBy(EVENT)?.name).toBe('date');
    expect(defaultDateBy(TASK)?.name).toBe('date');
    expect(defaultDateBy(BOOK)?.name).toBe('published');
    expect(defaultDateBy(TRIP)?.name).toBe('departs');
    expect(defaultDateBy(RECIPE)).toBeNull();
  });

  it('a non-date property named `date` is not the default', () => {
    expect(defaultDateBy([p('date', 'text'), p('due', 'date')])?.name).toBe('due');
  });
});

describe('parseDateBy (#2701)', () => {
  it('keeps any non-empty string — the parser does not know the type', () => {
    expect(parseDateBy('published')).toBe('published');
    expect(parseDateBy('not-a-date-property')).toBe('not-a-date-property');
  });

  it('drops anything else, without throwing', () => {
    for (const bad of ['', '   ', 42, null, undefined, true, {}, ['date']]) expect(parseDateBy(bad)).toBeNull();
  });
});

describe('resolveDateBy (#2701)', () => {
  it('uses the explicit choice when it is one, else the default', () => {
    expect(resolveDateBy('returns', TRIP)?.name).toBe('returns');
    expect(resolveDateBy(null, TRIP)?.name).toBe('departs');
    expect(resolveDateBy('city', TRIP)?.name).toBe('departs'); // a text property
    expect(resolveDateBy('gone', TRIP)?.name).toBe('departs'); // since renamed
    expect(resolveDateBy('end', EVENT)?.name).toBe('date'); // Event's end is not a start
    expect(resolveDateBy('published', RECIPE)).toBeNull();
  });
});

describe('dateByForSpec (#2701)', () => {
  it('keeps an explicit choice that names a date choice, and drops anything else', () => {
    expect(dateByForSpec('returns', TRIP)).toBe('returns');
    expect(dateByForSpec('departs', TRIP)).toBe('departs'); // the default, chosen explicitly, is kept
    expect(dateByForSpec('city', TRIP)).toBeNull(); // not a date: dropped
    expect(dateByForSpec('gone', TRIP)).toBeNull();
    expect(dateByForSpec('end', EVENT)).toBeNull();
    expect(dateByForSpec(null, TRIP)).toBeNull();
    expect(dateByForSpec(undefined, TRIP)).toBeNull();
  });

  it('keeps the choice as written where the schema is not known', () => {
    expect(dateByForSpec('anything', null)).toBe('anything');
    expect(dateByForSpec(null, null)).toBeNull();
  });
});

describe('endPropertyFor (#2701, Decision 2)', () => {
  it('is Event\'s `end`, only when the view is dated by `date`', () => {
    expect(endPropertyFor(resolveDateBy(null, EVENT), EVENT)?.name).toBe('end');
    expect(endPropertyFor(resolveDateBy(null, TASK), TASK)).toBeNull(); // no `end`
    expect(endPropertyFor(resolveDateBy(null, TRIP), TRIP)).toBeNull(); // `returns` is not an end
    expect(endPropertyFor(resolveDateBy('started', ENDS_ONLY), ENDS_ONLY)).toBeNull();
    expect(endPropertyFor(null, EVENT)).toBeNull();
  });
});

describe('hasDateProperty and settledPropertyDefs: the one rule behind canShowCalendar and canShowTimeline (#2715)', () => {
  const TYPES = [
    { id: 'book', properties: BOOK },
    { id: 'novel', parent: 'book', properties: [] },
    { id: 'recipe', properties: RECIPE },
    { id: 'orphan', parent: 'missing', properties: [p('when', 'date')] },
  ];

  it('is true for an own or inherited date property, false for none and for a type the catalog lacks', () => {
    expect(hasDateProperty('book', TYPES)).toBe(true);
    expect(hasDateProperty('novel', TYPES)).toBe(true);
    expect(hasDateProperty('recipe', TYPES)).toBe(false);
    expect(hasDateProperty('ghost', TYPES)).toBe(false);
    expect(hasDateProperty('orphan', TYPES)).toBe(true); // its own date, whatever its parent turns out to be
  });

  it('settles the effective properties only when the whole chain is in the catalog', () => {
    expect(names(settledPropertyDefs('novel', TYPES)!)).toEqual(['author', 'published', 'rating']);
    expect(settledPropertyDefs('orphan', TYPES)).toBeNull();
    expect(settledPropertyDefs('ghost', TYPES)).toBeNull();
    expect(settledPropertyDefs('book', null)).toBeNull();
  });
});
