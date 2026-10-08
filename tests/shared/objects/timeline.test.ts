/**
 * The Timeline layout's view-spec model (#2607): which types may show it (any
 * type with a date or datetime property since #2715 — the same rule as
 * Calendar's), the `from` / `to` range it pins, read through the spike's
 * date-precision rule (#2611), and the shared `dateBy` field.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  canShowTimeline, DEFAULT_VIEW_LAYOUT, FIT_ALL, isFitAll, parseTimelineEdge, parseTimelineRange,
  timelineDomain, timelineRangeFromDomain, timelineSpecForType,
} from '../../../src/shared/objects/timeline';
import { canShowCalendar } from '../../../src/shared/objects/calendar';
import { inheritsFrom } from '../../../src/shared/objects/inheritance';
import { civilMs } from '../../../src/shared/objects/date-precision';
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
  { id: 'event', properties: [p('date', 'datetime'), p('end', 'datetime')] },
  { id: 'conference', parent: 'event', properties: [p('track', 'text')] }, // a user subtype of Event
  { id: 'keynote', parent: 'conference', properties: [] }, // a grandchild
  { id: 'book', properties: [p('author', 'text'), p('published', 'date')] },
  { id: 'novel', parent: 'book', properties: [] }, // inherits Book's `published`
  { id: 'trip', properties: [p('departs', 'date'), p('returns', 'datetime'), p('city', 'text')] }, // two date properties
  { id: 'recipe', properties: [p('serves', 'number'), p('cuisine', 'enum')] }, // no date property
  { id: 'orphan', parent: 'missing', properties: [] }, // its chain breaks
  { id: 'loop-a', parent: 'loop-b', properties: [] },
  { id: 'loop-b', parent: 'loop-a', properties: [] },
];

describe('canShowTimeline (#2607, #2715)', () => {
  it('is true for Event, its subtypes and grandchildren, by the date they inherit', () => {
    expect(canShowTimeline('event', TYPES)).toBe(true);
    expect(canShowTimeline('conference', TYPES)).toBe(true);
    expect(canShowTimeline('keynote', TYPES)).toBe(true);
  });

  it('is true for Book, by its `published` date — not only Event and its subtypes', () => {
    expect(canShowTimeline('book', TYPES)).toBe(true);
  });

  it('is true for a type with two date properties', () => {
    expect(canShowTimeline('trip', TYPES)).toBe(true);
  });

  it('is true for a subtype that only inherits its date', () => {
    expect(canShowTimeline('novel', TYPES)).toBe(true);
  });

  it('is false for a type with no date property', () => {
    expect(canShowTimeline('recipe', TYPES)).toBe(false);
  });

  it('is false for a type the catalog lacks, a broken dateless chain, and a dateless cycle — without looping', () => {
    expect(canShowTimeline('ghost', TYPES)).toBe(false);
    expect(canShowTimeline('orphan', TYPES)).toBe(false);
    expect(canShowTimeline('loop-a', TYPES)).toBe(false);
  });

  it('is false for a subtype when the catalog no longer has the ancestor its date comes from', () => {
    expect(canShowTimeline('conference', TYPES.filter((t) => t.id !== 'event'))).toBe(false);
  });

  it('offers it on exactly the seven stock types the design story lists', () => {
    const offered = STOCK.filter((t) => canShowTimeline(t.id, STOCK)).map((t) => t.id).sort();
    expect(offered).toEqual(['article', 'book', 'claim', 'event', 'idea', 'meeting', 'project']);
  });

  it('is the same rule as canShowCalendar, type for type', () => {
    for (const t of [...TYPES, ...STOCK]) {
      expect(canShowTimeline(t.id, [...TYPES, ...STOCK])).toBe(canShowCalendar(t.id, [...TYPES, ...STOCK]));
    }
  });
});

describe('inheritsFrom (#2607)', () => {
  const byId = new Map(TYPES.map((t) => [t.id, t] as const));
  it('walks parent to any depth, counts the type itself, and stops on a cycle', () => {
    expect(inheritsFrom('keynote', 'conference', byId)).toBe(true);
    expect(inheritsFrom('keynote', 'keynote', byId)).toBe(true);
    expect(inheritsFrom('conference', 'keynote', byId)).toBe(false);
    expect(inheritsFrom('loop-a', 'loop-b', byId)).toBe(true);
    expect(inheritsFrom('loop-a', 'event', byId)).toBe(false);
  });
});

describe('parseTimelineEdge (#2607)', () => {
  it('keeps a year, a month and a day as written', () => {
    expect(parseTimelineEdge('1960')).toBe('1960');
    expect(parseTimelineEdge('1975-06')).toBe('1975-06');
    expect(parseTimelineEdge('1969-07-20')).toBe('1969-07-20');
    expect(parseTimelineEdge('  1969-07-20 ')).toBe('1969-07-20');
  });

  it('keeps BCE values in astronomical numbering', () => {
    expect(parseTimelineEdge('-0043')).toBe('-0043');
    expect(parseTimelineEdge('-0043-03-15')).toBe('-0043-03-15');
    expect(parseTimelineEdge('0000')).toBe('0000');
  });

  it('takes a whole number as its digits (JSON and YAML make `1960` a number)', () => {
    expect(parseTimelineEdge(1960)).toBe('1960');
    expect(parseTimelineEdge(-43)).toBe('-43');
  });

  it('takes a clock value too, with `datetime` (#2608, #2613)', () => {
    expect(parseTimelineEdge('1969-07-20T20:17')).toBe('1969-07-20T20:17');
    expect(parseTimelineEdge('1969-07-20T20:17:40Z')).toBe('1969-07-20T20:17:40Z');
  });

  it('drops anything that is not a date value, without throwing', () => {
    for (const bad of [
      '', '   ', 'soon', '1969-13', '1969-02-30', '-0000', '07/20/1969', '1969-07-20T24:00', '1969-07-20T20:17+15:00',
      1960.5, NaN, Infinity, null, undefined, true, {}, ['1960'],
    ]) {
      expect(parseTimelineEdge(bad)).toBeNull();
    }
  });
});

describe('parseTimelineRange (#2607)', () => {
  it('reads both edges, or one', () => {
    expect(parseTimelineRange('1960', '1975')).toEqual({ from: '1960', to: '1975' });
    expect(parseTimelineRange('1960', undefined)).toEqual({ from: '1960', to: null });
    expect(parseTimelineRange(undefined, '1975-06')).toEqual({ from: null, to: '1975-06' });
  });

  it('both absent is fit all', () => {
    expect(parseTimelineRange(undefined, undefined)).toEqual(FIT_ALL);
    expect(isFitAll(parseTimelineRange(null, null))).toBe(true);
  });

  it('drops an invalid edge on its own, keeping the other', () => {
    expect(parseTimelineRange('soon', '1975')).toEqual({ from: null, to: '1975' });
    expect(parseTimelineRange('1960', 42.5)).toEqual({ from: '1960', to: null });
  });

  it('reads a `to` that ends before `from` begins as fit all — not swapped', () => {
    expect(parseTimelineRange('1975', '1960')).toEqual(FIT_ALL);
    expect(parseTimelineRange('1969-07-21', '1969-07-20')).toEqual(FIT_ALL);
    expect(parseTimelineRange('-0043', '-0044')).toEqual(FIT_ALL);
  });

  it('a one-span range, and a `to` inside `from`\'s span, are both real ranges', () => {
    expect(parseTimelineRange('1969', '1969')).toEqual({ from: '1969', to: '1969' });
    expect(parseTimelineRange('1969', '1969-03')).toEqual({ from: '1969', to: '1969-03' });
  });

  it('a BCE-to-CE range reads', () => {
    expect(parseTimelineRange('-0043', '0014')).toEqual({ from: '-0043', to: '0014' });
  });
});

describe('timelineDomain (#2607)', () => {
  it('runs from the start of `from`\'s span to the end of `to`\'s', () => {
    expect(timelineDomain({ from: '1960', to: '1975' })).toEqual({ start: civilMs(1960, 0, 1), end: civilMs(1976, 0, 1) });
    expect(timelineDomain({ from: '1975-06', to: '1969-07-20' })).toEqual({ start: null, end: null }); // backwards
    expect(timelineDomain({ from: '1969-07-20', to: '1969-07-20' })).toEqual({ start: civilMs(1969, 6, 20), end: civilMs(1969, 6, 21) });
  });

  it('a `to` at clock precision ends at that instant, as an event\'s `end` does', () => {
    expect(timelineDomain({ from: '1969-07-20T14:00', to: '1969-07-20T16:00' }))
      .toEqual({ start: civilMs(1969, 6, 20, 14), end: civilMs(1969, 6, 20, 16) });
    // A clock `to` at or before a clock `from` is no range.
    expect(timelineDomain({ from: '1969-07-20T14:00', to: '1969-07-20T14:00' })).toEqual({ start: null, end: null });
  });

  it('leaves an absent or unreadable side to the events', () => {
    expect(timelineDomain(FIT_ALL)).toEqual({ start: null, end: null });
    expect(timelineDomain({ from: '-0043', to: null })).toEqual({ start: civilMs(-43, 0, 1), end: null });
    expect(timelineDomain({ from: 'nope', to: '1975' })).toEqual({ start: null, end: civilMs(1976, 0, 1) });
  });
});

describe('timelineRangeFromDomain (#2607)', () => {
  it('writes whole years when both edges sit on year boundaries', () => {
    expect(timelineRangeFromDomain(civilMs(1960, 0, 1), civilMs(1976, 0, 1))).toEqual({ from: '1960', to: '1975' });
    expect(timelineRangeFromDomain(civilMs(-43, 0, 1), civilMs(15, 0, 1))).toEqual({ from: '-0043', to: '0014' });
    expect(timelineRangeFromDomain(civilMs(12026, 0, 1), civilMs(12027, 0, 1))).toEqual({ from: '+12026', to: '+12026' });
  });

  it('otherwise writes the days the domain touches', () => {
    expect(timelineRangeFromDomain(civilMs(1969, 6, 20, 13), civilMs(1969, 6, 24))).toEqual({ from: '1969-07-20', to: '1969-07-23' });
    expect(timelineRangeFromDomain(civilMs(1969, 0, 1), civilMs(1969, 6, 24, 6))).toEqual({ from: '1969-01-01', to: '1969-07-24' });
  });

  it('zoomed in below whole days, writes the minutes the domain touches (#2608)', () => {
    expect(timelineRangeFromDomain(civilMs(1969, 6, 20, 13, 30, 20), civilMs(1969, 6, 20, 16, 5, 1)))
      .toEqual({ from: '1969-07-20T13:30', to: '1969-07-20T16:06' });
    // A day and a half that doesn't sit on midnight would round out to three days: minutes.
    expect(timelineRangeFromDomain(civilMs(1969, 6, 20, 12), civilMs(1969, 6, 22))).toEqual({ from: '1969-07-20T12:00', to: '1969-07-22T00:00' });
    expect(timelineRangeFromDomain(civilMs(-43, 2, 15, 9), civilMs(-43, 2, 15, 11))).toEqual({ from: '-0043-03-15T09:00', to: '-0043-03-15T11:00' });
    // Whole days are still days, however short.
    expect(timelineRangeFromDomain(civilMs(1969, 6, 20), civilMs(1969, 6, 21))).toEqual({ from: '1969-07-20', to: '1969-07-20' });
  });

  it('round-trips: what it writes reads back as a domain covering the input', () => {
    for (const [s, e] of [
      [civilMs(1960, 0, 1), civilMs(1976, 0, 1)],
      [civilMs(1969, 6, 20, 13), civilMs(1969, 6, 24, 1)],
      [civilMs(-43, 2, 15), civilMs(-43, 2, 16)],
      [civilMs(1969, 6, 20, 13, 30, 20), civilMs(1969, 6, 20, 16, 5, 1)],
      [civilMs(1969, 6, 20, 23, 50), civilMs(1969, 6, 21, 0, 10)],
    ] as const) {
      const range = timelineRangeFromDomain(s, e);
      expect(parseTimelineRange(range.from, range.to)).toEqual(range);
      const d = timelineDomain(range);
      expect(d.start).toBeLessThanOrEqual(s);
      expect(d.end).toBeGreaterThanOrEqual(e);
    }
  });

  it('is fit all for an empty, backwards or non-finite domain', () => {
    expect(timelineRangeFromDomain(5, 5)).toEqual(FIT_ALL);
    expect(timelineRangeFromDomain(10, 5)).toEqual(FIT_ALL);
    expect(timelineRangeFromDomain(NaN, 5)).toEqual(FIT_ALL);
  });
});

describe('timelineSpecForType (#2607, #2715)', () => {
  const pinned = { layout: 'timeline' as const, from: '1960', to: '1975', dateBy: null };

  it('keeps a timeline spec for any type with a date property, own or inherited', () => {
    expect(timelineSpecForType(pinned, 'event', TYPES)).toEqual(pinned);
    expect(timelineSpecForType(pinned, 'keynote', TYPES)).toEqual(pinned);
    expect(timelineSpecForType(pinned, 'book', TYPES)).toEqual(pinned);
    expect(timelineSpecForType(pinned, 'novel', TYPES)).toEqual(pinned);
  });

  it('reads `timeline` for a dateless type as the default layout, dropping the range and dateBy', () => {
    expect(DEFAULT_VIEW_LAYOUT).toBe('table');
    const dated = { ...pinned, dateBy: 'serves' };
    expect(timelineSpecForType(dated, 'recipe', TYPES)).toEqual({ layout: 'table', from: null, to: null, dateBy: null });
    expect(timelineSpecForType({ ...dated, layout: 'gallery' }, 'recipe', TYPES)).toEqual({ layout: 'gallery', from: null, to: null, dateBy: null });
  });

  it('keeps a dated view\'s range and dateBy under another layout, so switching back keeps them', () => {
    expect(timelineSpecForType({ ...pinned, layout: 'list' }, 'event', TYPES)).toEqual({ ...pinned, layout: 'list' });
    expect(timelineSpecForType({ ...pinned, layout: 'calendar', dateBy: 'returns' }, 'trip', TYPES))
      .toEqual({ ...pinned, layout: 'calendar', dateBy: 'returns' });
  });

  it('keeps a dateBy that names one of the type\'s date choices, own or inherited — the default included', () => {
    expect(timelineSpecForType({ ...pinned, dateBy: 'returns' }, 'trip', TYPES).dateBy).toBe('returns');
    expect(timelineSpecForType({ ...pinned, dateBy: 'departs' }, 'trip', TYPES).dateBy).toBe('departs');
    expect(timelineSpecForType({ ...pinned, dateBy: 'published' }, 'novel', TYPES).dateBy).toBe('published');
    expect(timelineSpecForType({ ...pinned, dateBy: 'date' }, 'keynote', TYPES).dateBy).toBe('date');
  });

  it('drops a dateBy that is not a date choice: a text property, an unknown name, or Event\'s `end`', () => {
    expect(timelineSpecForType({ ...pinned, dateBy: 'city' }, 'trip', TYPES)).toEqual({ ...pinned, dateBy: null });
    expect(timelineSpecForType({ ...pinned, dateBy: 'renamed' }, 'book', TYPES).dateBy).toBeNull();
    expect(timelineSpecForType({ ...pinned, dateBy: 'end' }, 'event', TYPES).dateBy).toBeNull();
  });

  it('keeps the spec as written where the type is not known yet', () => {
    const odd = { ...pinned, dateBy: 'anything' };
    expect(timelineSpecForType(odd, 'recipe', null)).toEqual(odd);
    expect(timelineSpecForType(odd, 'not-loaded', TYPES)).toEqual(odd);
    // A chain that leaves the catalog may yet reach a date once it loads.
    expect(timelineSpecForType(odd, 'orphan', TYPES)).toEqual(odd);
    expect(timelineSpecForType(odd, 'keynote', [{ id: 'keynote', parent: 'conference', properties: [] }])).toEqual(odd);
  });

  it('a dateless cycle is settled, not unknown', () => {
    expect(timelineSpecForType(pinned, 'loop-a', TYPES)).toEqual({ layout: 'table', from: null, to: null, dateBy: null });
  });
});
