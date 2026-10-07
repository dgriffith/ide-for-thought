/**
 * The Timeline layout's view-spec model (#2607): which types may show it, and
 * the `from` / `to` range it pins, read through the spike's date-precision
 * rule (#2611).
 */
import { describe, it, expect } from 'vitest';
import {
  canShowTimeline, DEFAULT_VIEW_LAYOUT, EVENT_TYPE_ID, FIT_ALL, isFitAll, parseTimelineEdge, parseTimelineRange,
  timelineDomain, timelineRangeFromDomain, timelineSpecForType,
} from '../../../src/shared/objects/timeline';
import { inheritsFrom } from '../../../src/shared/objects/inheritance';
import { civilMs } from '../../../src/shared/objects/date-precision';

const TYPES = [
  { id: 'event', properties: [] },
  { id: 'conference', parent: 'event', properties: [] }, // a user subtype of Event
  { id: 'keynote', parent: 'conference', properties: [] }, // a grandchild
  { id: 'book', properties: [] },
  { id: 'novel', parent: 'book', properties: [] },
  { id: 'orphan', parent: 'missing', properties: [] }, // its chain breaks
  { id: 'loop-a', parent: 'loop-b', properties: [] },
  { id: 'loop-b', parent: 'loop-a', properties: [] },
];

describe('canShowTimeline (#2607)', () => {
  it('is true for Event itself', () => {
    expect(EVENT_TYPE_ID).toBe('event');
    expect(canShowTimeline('event', TYPES)).toBe(true);
  });

  it('is true for a user subtype of Event (`parent: event`)', () => {
    expect(canShowTimeline('conference', TYPES)).toBe(true);
  });

  it('is true for a grandchild of Event', () => {
    expect(canShowTimeline('keynote', TYPES)).toBe(true);
  });

  it('is false for a non-Event type, and for its subtypes', () => {
    expect(canShowTimeline('book', TYPES)).toBe(false);
    expect(canShowTimeline('novel', TYPES)).toBe(false);
  });

  it('is false for a type the catalog lacks, a broken chain, and a cycle — without looping', () => {
    expect(canShowTimeline('ghost', TYPES)).toBe(false);
    expect(canShowTimeline('orphan', TYPES)).toBe(false);
    expect(canShowTimeline('loop-a', TYPES)).toBe(false);
  });

  it('is false for a subtype when the catalog no longer has Event', () => {
    expect(canShowTimeline('conference', TYPES.filter((t) => t.id !== 'event'))).toBe(false);
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

  it('drops anything that is not a calendar date value, without throwing', () => {
    for (const bad of [
      '', '   ', 'soon', '1969-13', '1969-02-30', '-0000', '07/20/1969', '1969-07-20T20:17', '1969-07-20T20:17Z',
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

  it('round-trips: what it writes reads back as a domain covering the input', () => {
    for (const [s, e] of [
      [civilMs(1960, 0, 1), civilMs(1976, 0, 1)],
      [civilMs(1969, 6, 20, 13), civilMs(1969, 6, 24, 1)],
      [civilMs(-43, 2, 15), civilMs(-43, 2, 16)],
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

describe('timelineSpecForType (#2607)', () => {
  const pinned = { layout: 'timeline' as const, from: '1960', to: '1975' };

  it('keeps a timeline spec for Event and its subtypes', () => {
    expect(timelineSpecForType(pinned, 'event', TYPES)).toEqual(pinned);
    expect(timelineSpecForType(pinned, 'keynote', TYPES)).toEqual(pinned);
  });

  it('reads `timeline` for another type as the default layout, dropping the range', () => {
    expect(DEFAULT_VIEW_LAYOUT).toBe('table');
    expect(timelineSpecForType(pinned, 'book', TYPES)).toEqual({ layout: 'table', from: null, to: null });
    expect(timelineSpecForType({ ...pinned, layout: 'gallery' }, 'book', TYPES)).toEqual({ layout: 'gallery', from: null, to: null });
  });

  it('keeps an Event view\'s range under another layout, so switching back keeps it', () => {
    expect(timelineSpecForType({ ...pinned, layout: 'list' }, 'event', TYPES)).toEqual({ ...pinned, layout: 'list' });
  });

  it('keeps the spec as written where the type is not known yet', () => {
    expect(timelineSpecForType(pinned, 'book', null)).toEqual(pinned);
    expect(timelineSpecForType(pinned, 'not-loaded', TYPES)).toEqual(pinned);
    // A chain that leaves the catalog may yet reach Event once it loads.
    expect(timelineSpecForType(pinned, 'orphan', TYPES)).toEqual(pinned);
    expect(timelineSpecForType(pinned, 'keynote', [{ id: 'keynote', parent: 'conference' }])).toEqual(pinned);
  });

  it('a non-Event cycle is settled, not unknown', () => {
    expect(timelineSpecForType(pinned, 'loop-a', TYPES)).toEqual({ layout: 'table', from: null, to: null });
  });
});
