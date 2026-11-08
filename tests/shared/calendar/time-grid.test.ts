/**
 * The Week and Day pages' model (#2950, epic #2949): placement by precision,
 * the 24-hour rule, overlap lanes and clusters, invented ends, the midnight
 * cut, DST days and offset values. See `time-grid.ts`'s header.
 */
import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TIMED_MINUTES, dstNote, layoutDay, layoutTimeGrid, timeGridPlacement,
  type TimeGridEvent, type TimedPiece, type UnpackedPiece,
} from '../../../src/shared/calendar/time-grid';
import { timePage, type Weekday } from '../../../src/shared/objects/calendar-grid';
import { civilMs, dateRange } from '../../../src/shared/objects/date-precision';
import { writtenAs } from '../../../src/shared/calendar/calendar-model';

const MIN = 60_000;
const HOUR = 60 * MIN;
const day = (y: number, m: number, d: number) => civilMs(y, m - 1, d);
const MON: Weekday = 1;
/** Monday 5 – Sunday 11 October 2026. */
const WEEK = timePage(day(2026, 10, 7), 'week', MON);

/** An event as the model reads one, in a viewer zone of UTC unless given. */
function ev(key: string, start: string, end?: string, zone = 0): TimeGridEvent {
  const r = dateRange(start, end, { zoneOffsetMinutes: () => zone });
  if (!r.ok) throw new Error(`not a range: ${start}`);
  return { key, title: key, ...r.range };
}

const at = (pieces: TimedPiece[], key: string) => pieces.find((p) => p.key === key)!;
const shape = (p: TimedPiece) => [p.startMin, p.endMin, p.lane, p.lanes];

describe('timePage (#2950)', () => {
  it('is the week containing the day, from the week start, or the day alone', () => {
    expect(WEEK.start).toBe(day(2026, 10, 5));
    expect(WEEK.end).toBe(day(2026, 10, 12));
    expect(WEEK.days.map((d) => d.day)).toEqual([5, 6, 7, 8, 9, 10, 11]);
    const sunday = timePage(day(2026, 10, 7), 'week', 7);
    expect(sunday.days.map((d) => d.day)).toEqual([4, 5, 6, 7, 8, 9, 10]);
    const one = timePage(day(2026, 10, 7) + 5 * HOUR, 'day', MON);
    expect(one).toMatchObject({ start: day(2026, 10, 7), end: day(2026, 10, 8) });
    expect(one.days).toHaveLength(1);
  });

  it('marks the days of the anchor\'s month across a month boundary', () => {
    const page = timePage(day(2026, 10, 30), 'week', MON); // Mon 26 Oct – Sun 1 Nov
    expect(page.days.map((d) => d.inMonth)).toEqual([true, true, true, true, true, true, false]);
  });
});

describe('timeGridPlacement (#2950)', () => {
  it('puts a day start in the strip, however it ends', () => {
    expect(timeGridPlacement(ev('a', '2026-10-06'))).toBe('allDay');
    expect(timeGridPlacement(ev('b', '2026-10-06', '2026-10-08'))).toBe('allDay');
    expect(timeGridPlacement(ev('c', '2026-10-06', '2026-10-06T14:00'))).toBe('allDay');
  });

  it('puts a clock start in the hour grid, ended or not', () => {
    expect(timeGridPlacement(ev('a', '2026-10-06T09:00'))).toBe('timed');
    expect(timeGridPlacement(ev('b', '2026-10-06T09:00', '2026-10-06T10:30'))).toBe('timed');
    expect(timeGridPlacement(ev('c', '2026-10-06T22:00', '2026-10-07T02:00'))).toBe('timed'); // crosses midnight, < 24 h
    expect(timeGridPlacement(ev('d', '2026-10-06T09:00', '2026-10-06'))).toBe('timed'); // a coarse end on its own day
  });

  it('puts a clock start of 24 hours or more, or a coarse end on a later day, in the strip', () => {
    expect(timeGridPlacement(ev('a', '2026-10-06T09:00', '2026-10-07T09:00'))).toBe('allDay');
    expect(timeGridPlacement(ev('b', '2026-10-06T09:00', '2026-10-07T08:59'))).toBe('timed');
    expect(timeGridPlacement(ev('c', '2026-10-06T09:00', '2026-10-08'))).toBe('allDay');
    expect(timeGridPlacement(ev('d', '2026-10-06T09:00', '2026-11'))).toBe('allDay');
  });
});

describe('layoutTimeGrid (#2950)', () => {
  it('places a week of mixed events: strip bars, hour pieces by column and minute', () => {
    const out = layoutTimeGrid([
      ev('holiday', '2026-10-05', '2026-10-06'),
      ev('conference', '2026-10-07T09:00', '2026-10-09T17:00'),
      ev('standup', '2026-10-06T09:30', '2026-10-06T09:45'),
      ev('lunch', '2026-10-08T12:00', '2026-10-08T13:00'),
      ev('outside', '2026-10-20T12:00', '2026-10-20T13:00'),
      ev('old', '2026-09-01', '2026-09-02'),
    ], WEEK);
    expect(out.allDay.segments.map((s) => [s.key, s.startCol, s.endCol, s.slot])).toEqual([
      ['holiday', 0, 2, 0],
      ['conference', 2, 5, 0],
    ]);
    expect(out.timed.map((col) => col.map((p) => p.key))).toEqual([[], ['standup'], [], ['lunch'], [], [], []]);
    expect(at(out.timed[1]!, 'standup')).toMatchObject({ col: 1, startMin: 570, endMin: 585, endKnown: true, lane: 0, lanes: 1 });
    expect(at(out.timed[3]!, 'lunch')).toMatchObject({ startMin: 720, endMin: 780 });
  });

  it('a strip bar running past the page is marked as continuing', () => {
    const out = layoutTimeGrid([ev('trip', '2026-10-01', '2026-10-07')], WEEK);
    expect(out.allDay.segments[0]).toMatchObject({ startCol: 0, endCol: 3, continuesBefore: true, continuesAfter: false });
  });

  it('cuts a timed event at midnight, marked as continuing on both sides', () => {
    const out = layoutTimeGrid([ev('night', '2026-10-06T22:00', '2026-10-07T02:30')], WEEK);
    expect(at(out.timed[1]!, 'night')).toMatchObject({ startMin: 1320, endMin: 1440, continuesBefore: false, continuesAfter: true });
    expect(at(out.timed[2]!, 'night')).toMatchObject({ startMin: 0, endMin: 150, continuesBefore: true, continuesAfter: false });
  });

  it('an end at exactly midnight stays on its day', () => {
    const out = layoutTimeGrid([ev('late', '2026-10-06T23:00', '2026-10-07T00:00')], WEEK);
    expect(out.timed[1]!.map((p) => [p.startMin, p.endMin, p.continuesAfter])).toEqual([[1380, 1440, false]]);
    expect(out.timed[2]).toEqual([]);
  });

  it('draws no end, or a coarse end on the start\'s day, at the default length, marked', () => {
    const out = layoutTimeGrid([
      ev('call', '2026-10-06T14:00'),
      ev('workshop', '2026-10-07T10:00', '2026-10-07'),
    ], WEEK);
    expect(DEFAULT_TIMED_MINUTES).toBe(30);
    expect(at(out.timed[1]!, 'call')).toMatchObject({ startMin: 840, endMin: 870, endKnown: false });
    expect(at(out.timed[2]!, 'workshop')).toMatchObject({ startMin: 600, endMin: 630, endKnown: false });
  });

  it('an invented end stops at midnight rather than spilling onto the next day', () => {
    const out = layoutTimeGrid([ev('nightcap', '2026-10-06T23:45')], WEEK);
    expect(at(out.timed[1]!, 'nightcap')).toMatchObject({ startMin: 1425, endMin: 1440, continuesAfter: false, endKnown: false });
    expect(out.timed[2]).toEqual([]);
  });

  it('a day page has one column', () => {
    const page = timePage(day(2026, 10, 6), 'day', MON);
    const out = layoutTimeGrid([ev('standup', '2026-10-06T09:30', '2026-10-06T09:45'), ev('else', '2026-10-07T09:00')], page);
    expect(out.timed).toHaveLength(1);
    expect(out.timed[0]!.map((p) => [p.key, p.col])).toEqual([['standup', 0]]);
  });
});

describe('layoutDay: overlaps (#2950)', () => {
  const piece = (key: string, startMin: number, endMin: number): UnpackedPiece =>
    ({ key, title: key, col: 0, startMin, endMin, continuesBefore: false, continuesAfter: false, endKnown: true });

  it('an event overlapping nothing keeps the whole width', () => {
    expect(layoutDay([piece('a', 540, 600), piece('b', 600, 660)]).map(shape)).toEqual([[540, 600, 0, 1], [600, 660, 0, 1]]);
  });

  it('overlapping events share the width; each cluster counts its own lanes', () => {
    const out = layoutDay([
      piece('a', 540, 660), // 9–11
      piece('b', 570, 600), // 9:30–10
      piece('c', 600, 630), // 10–10:30: b's lane is free again
      piece('d', 615, 645), // 10:15–10:45: a and c are busy → third lane
      piece('e', 780, 840), // 13–14, alone
    ]);
    expect(out.map((p) => [p.key, p.lane, p.lanes])).toEqual([
      ['a', 0, 3], ['b', 1, 3], ['c', 1, 3], ['d', 2, 3], ['e', 0, 1],
    ]);
  });

  it('a chain of overlaps is one cluster, even where its ends don\'t overlap', () => {
    const out = layoutDay([piece('a', 540, 600), piece('b', 590, 650), piece('c', 640, 700)]);
    expect(out.map((p) => [p.key, p.lane, p.lanes])).toEqual([['a', 0, 2], ['b', 1, 2], ['c', 0, 2]]);
  });

  it('a very short event claims at least the minimum, so a neighbour doesn\'t cover it', () => {
    const out = layoutDay([piece('blip', 600, 605), piece('next', 610, 660)]);
    expect(out.map((p) => [p.key, p.lane, p.lanes])).toEqual([['blip', 0, 2], ['next', 1, 2]]);
    expect(layoutDay([piece('blip', 600, 605), piece('next', 610, 660)], 5).map((p) => p.lanes)).toEqual([1, 1]);
  });

  it('is deterministic: equal times order by title then key', () => {
    const out = layoutDay([piece('b', 540, 600), piece('a', 540, 600)]);
    expect(out.map((p) => [p.key, p.lane])).toEqual([['a', 0], ['b', 1]]);
  });
});

describe('dstNote (#2950): 24 equal hours, the change reported', () => {
  /** US Eastern, 2026: EDT from 8 March 07:00Z to 1 November 06:00Z. */
  const eastern = (t: number) => (t >= Date.UTC(2026, 2, 8, 7) && t < Date.UTC(2026, 10, 1, 6) ? -240 : -300);
  /** Central Europe, 2026: CEST from 29 March 01:00Z to 25 October 01:00Z. */
  const berlin = (t: number) => (t >= Date.UTC(2026, 2, 29, 1) && t < Date.UTC(2026, 9, 25, 1) ? 120 : 60);
  /** Lord Howe: a half-hour change, 5 April 2026 at 15:00Z (+11 → +10:30). */
  const lordHowe = (t: number) => (t < Date.UTC(2026, 3, 4, 15) ? 660 : 630);

  it('spring forward: the hour that never happened', () => {
    expect(dstNote(day(2026, 3, 8), eastern)).toEqual({ kind: 'skipped', atMin: 120, minutes: 60 }); // 02:00–03:00
    expect(dstNote(day(2026, 3, 29), berlin)).toEqual({ kind: 'skipped', atMin: 120, minutes: 60 });
  });

  it('fall back: the hour that happened twice', () => {
    expect(dstNote(day(2026, 11, 1), eastern)).toEqual({ kind: 'repeated', atMin: 60, minutes: 60 }); // 01:00–02:00
    expect(dstNote(day(2026, 10, 25), berlin)).toEqual({ kind: 'repeated', atMin: 120, minutes: 60 }); // 02:00–03:00
    expect(dstNote(day(2026, 4, 5), lordHowe)).toEqual({ kind: 'repeated', atMin: 90, minutes: 30 });
  });

  it('every other day, and a zone without DST, has no note', () => {
    for (const d of [day(2026, 3, 7), day(2026, 3, 9), day(2026, 10, 31), day(2026, 11, 2)]) expect(dstNote(d, eastern)).toBeNull();
    expect(dstNote(day(2026, 3, 8), () => 0)).toBeNull();
  });

  it('the grid still draws the day in 24 hours: a floating time in the skipped hour sits where it says', () => {
    const page = timePage(day(2026, 3, 8), 'day', MON);
    const out = layoutTimeGrid([ev('ghost', '2026-03-08T02:30', '2026-03-08T03:30', -300)], page);
    expect(at(out.timed[0]!, 'ghost')).toMatchObject({ startMin: 150, endMin: 210 });
  });
});

describe('offset values (#2950, decision 7)', () => {
  it('land on the viewer\'s wall clock, and their day, with "Written as" kept', () => {
    // 23:30 in Los Angeles is 08:30 the next morning in Berlin (UTC+2 in October).
    const e = ev('call', '2026-10-06T23:30-07:00', '2026-10-07T00:30-07:00', 120);
    const out = layoutTimeGrid([e], WEEK);
    expect(out.timed[1]).toEqual([]);
    expect(at(out.timed[2]!, 'call')).toMatchObject({ startMin: 510, endMin: 570, endKnown: true });
    expect(writtenAs(e, '2026-10-06T23:30-07:00')).toBe('Written as 2026-10-06T23:30-07:00');
  });
});
