/**
 * The Calendar layout's view-spec model (#2701): which types may show it
 * (any type with a date or datetime property, own or inherited — Decision 1 of
 * the design story #2700), the `month` anchor, and how a spec reads back for a
 * known type.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { calendarSpecForType, canShowCalendar, parseCalendarMonth } from '../../../src/shared/objects/calendar';
import { DEFAULT_VIEW_LAYOUT } from '../../../src/shared/objects/timeline';
import { parseType } from '../../../src/main/types/parse';
import type { PropertyDef, TypeDef } from '../../../src/shared/objects/type-def';

/** The real stock types, parsed as the app parses them. */
const STOCK_DIR = join(__dirname, '../../../src/main/types/stock');
const STOCK: TypeDef[] = readdirSync(STOCK_DIR).filter((f) => f.endsWith('.md')).map((f) => {
  const { type, errors } = parseType(readFileSync(join(STOCK_DIR, f), 'utf8'), 'stock', f);
  expect(errors).toEqual([]);
  return type!;
});

const p = (name: string, type: PropertyDef['type']): PropertyDef => ({ name, type });
const TYPES = [
  ...STOCK,
  { id: 'trip', properties: [p('departs', 'date'), p('returns', 'datetime'), p('city', 'text')] }, // two date properties
  { id: 'conference', parent: 'event', properties: [p('track', 'text')] }, // a user subtype inheriting Event's date
  { id: 'novel', parent: 'book', properties: [] }, // inherits Book's `published`
  { id: 'recipe', properties: [p('serves', 'number'), p('cuisine', 'enum')] }, // no date property
  { id: 'orphan', parent: 'missing', properties: [p('note', 'text')] }, // its chain leaves the catalog
  { id: 'loop-a', parent: 'loop-b', properties: [] },
  { id: 'loop-b', parent: 'loop-a', properties: [] },
];

describe('canShowCalendar (#2701)', () => {
  it('is true for Event (its `date` and `end` are datetimes)', () => {
    expect(canShowCalendar('event', TYPES)).toBe(true);
  });

  it('is true for Book, by its `published` date — not only Event and its subtypes', () => {
    expect(canShowCalendar('book', TYPES)).toBe(true);
  });

  it('is true for a type with two date properties', () => {
    expect(canShowCalendar('trip', TYPES)).toBe(true);
  });

  it('is true for a user subtype that only inherits its date', () => {
    expect(canShowCalendar('conference', TYPES)).toBe(true);
    expect(canShowCalendar('novel', TYPES)).toBe(true);
    expect(canShowCalendar('meeting', TYPES)).toBe(true); // the stock subtype of Event
  });

  it('is false for a type with no date property', () => {
    expect(canShowCalendar('recipe', TYPES)).toBe(false);
  });

  it('offers it on exactly the seven stock types the design story lists', () => {
    const offered = STOCK.filter((t) => canShowCalendar(t.id, STOCK)).map((t) => t.id).sort();
    expect(offered).toEqual(['article', 'book', 'claim', 'event', 'idea', 'meeting', 'project']);
    expect(STOCK.filter((t) => !canShowCalendar(t.id, STOCK)).map((t) => t.id).sort()).toEqual(['glossary-term', 'person', 'place']);
  });

  it('is false for a type the catalog lacks, and for a cycle — without looping', () => {
    expect(canShowCalendar('ghost', TYPES)).toBe(false);
    expect(canShowCalendar('loop-a', TYPES)).toBe(false);
  });
});

describe('parseCalendarMonth (#2701)', () => {
  it('keeps a month anchor, in its canonical text', () => {
    expect(parseCalendarMonth('2026-10')).toBe('2026-10');
    expect(parseCalendarMonth('  2026-10 ')).toBe('2026-10');
    expect(parseCalendarMonth('0001-01')).toBe('0001-01');
  });

  it('keeps a BCE month in astronomical numbering, and a five-digit year', () => {
    expect(parseCalendarMonth('-0043-03')).toBe('-0043-03'); // March 44 BCE
    expect(parseCalendarMonth('0000-02')).toBe('0000-02'); // 1 BCE
    expect(parseCalendarMonth('+12026-01')).toBe('+12026-01');
  });

  it('drops anything that is not a month — a day, a year, a clock time, junk — without throwing', () => {
    for (const bad of [
      '', '  ', 'soon', '2026', '2026-10-07', '2026-10-07T09:00', '2026-13', '2026-00', '10/2026', '-0000-03',
      202610, 2026.5, NaN, null, undefined, true, {}, ['2026-10'],
    ]) {
      expect(parseCalendarMonth(bad)).toBeNull();
    }
  });
});

describe('calendarSpecForType (#2701)', () => {
  const pinned = { layout: 'calendar' as const, month: '2026-10', dateBy: null };

  it('keeps a calendar spec for a type with a date property, own or inherited', () => {
    expect(calendarSpecForType(pinned, 'event', TYPES)).toEqual(pinned);
    expect(calendarSpecForType(pinned, 'book', TYPES)).toEqual(pinned);
    expect(calendarSpecForType(pinned, 'conference', TYPES)).toEqual(pinned);
  });

  it('reads `calendar` for a type with no date property as the default layout, dropping month and dateBy', () => {
    expect(DEFAULT_VIEW_LAYOUT).toBe('table');
    expect(calendarSpecForType({ ...pinned, dateBy: 'serves' }, 'recipe', TYPES)).toEqual({ layout: 'table', month: null, dateBy: null });
    expect(calendarSpecForType({ ...pinned, layout: 'kanban' }, 'recipe', TYPES)).toEqual({ layout: 'kanban', month: null, dateBy: null });
  });

  it('keeps the month under another layout, so switching back to Calendar keeps the page', () => {
    expect(calendarSpecForType({ ...pinned, layout: 'list' }, 'event', TYPES)).toEqual({ ...pinned, layout: 'list' });
  });

  it('keeps a dateBy that names one of the type\'s date choices, inherited included', () => {
    expect(calendarSpecForType({ ...pinned, dateBy: 'returns' }, 'trip', TYPES)).toMatchObject({ dateBy: 'returns' });
    expect(calendarSpecForType({ ...pinned, dateBy: 'published' }, 'novel', TYPES)).toMatchObject({ dateBy: 'published' });
    expect(calendarSpecForType({ ...pinned, dateBy: 'date' }, 'conference', TYPES)).toMatchObject({ dateBy: 'date' });
  });

  it('drops a dateBy that is not a date property, is unknown, or is Event\'s `end`', () => {
    expect(calendarSpecForType({ ...pinned, dateBy: 'city' }, 'trip', TYPES)).toEqual(pinned); // a text property
    expect(calendarSpecForType({ ...pinned, dateBy: 'renamed' }, 'trip', TYPES)).toEqual(pinned);
    expect(calendarSpecForType({ ...pinned, dateBy: 'end' }, 'event', TYPES)).toEqual(pinned); // ends `date`; doesn't start
  });

  it('keeps the spec as written where the type is not known yet', () => {
    const odd = { ...pinned, dateBy: 'whatever' };
    expect(calendarSpecForType(odd, 'recipe', null)).toEqual(odd);
    expect(calendarSpecForType(odd, 'not-loaded', TYPES)).toEqual(odd);
    // A chain that leaves the catalog may yet inherit a date once it loads.
    expect(calendarSpecForType(odd, 'orphan', TYPES)).toEqual(odd);
    expect(calendarSpecForType(odd, 'conference', [{ id: 'conference', parent: 'event', properties: [] }])).toEqual(odd);
  });

  it('a dateless cycle is settled, not unknown', () => {
    expect(calendarSpecForType(pinned, 'loop-a', TYPES)).toEqual({ layout: 'table', month: null, dateBy: null });
  });
});
