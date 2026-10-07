/**
 * The Timeline's event model and layout (#2608): each instance's `date` /
 * `end` read into spans or the Undated tray; partial dates hatched; a
 * backwards or unreadable `end` set aside and flagged; spoken labels through
 * `Intl`; lanes packed in px at a zoom; keyboard order; and the culling that
 * keeps the tab stop.
 */
import { describe, it, expect } from 'vitest';
import { civilMs, dateSpan } from '../../../../src/shared/objects/date-precision';
import { buildTimelineModel, segmentsOf } from '../../../../src/renderer/lib/components/timeline/timeline-events';
import { cullToView, labelWidth, layoutTimeline, MARKER_PX, shortLabel, MAX_LABEL_CHARS, timeOrder, trailingLabelRoom } from '../../../../src/renderer/lib/components/timeline/timeline-layout';
import { formatCivil, formatCivilRange } from '../../../../src/renderer/lib/components/timeline/timeline-format';

const row = (path: string, title: string, date: string | null, end: string | null = null) =>
  ({ path, title, values: { date, end }, cover: null });
/** `Intl` spaces a range with thin spaces; compare with plain ones. */
const norm = (s: string) => s.replace(/\s/g, ' ');
const build = (rows: ReturnType<typeof row>[]) => buildTimelineModel(rows, { locale: 'en-GB' });

describe('formatCivil / formatCivilRange', () => {
  it('writes a value at its precision, with an era only for years ≤ 0', () => {
    expect(formatCivil(civilMs(1969, 6, 20), 'day', 'en-GB')).toBe('20 July 1969');
    expect(formatCivil(civilMs(1969, 6, 1), 'month', 'en-GB')).toBe('July 1969');
    expect(formatCivil(civilMs(-43, 0, 1), 'year', 'en-GB')).toBe('44 BC');
    expect(formatCivil(civilMs(12026, 0, 1), 'year', 'en-GB')).toBe('12026');
    expect(formatCivil(civilMs(1969, 6, 20, 20, 17), 'minute', 'en-GB')).toBe('20 July 1969 at 20:17');
  });

  it('writes a range compactly when both ends share a precision', () => {
    expect(norm(formatCivilRange(civilMs(1969, 6, 16), 'day', civilMs(1969, 6, 24), 'day', 'en-GB'))).toBe('16 – 24 July 1969');
    expect(norm(formatCivilRange(civilMs(1618, 0, 1), 'year', civilMs(1648, 0, 1), 'year', 'en-GB'))).toBe('1618 – 1648');
    expect(norm(formatCivilRange(civilMs(1969, 6, 20), 'day', civilMs(1970, 0, 1), 'year', 'en-GB'))).toBe('20 July 1969 – 1970');
  });
});

describe('buildTimelineModel', () => {
  const m = build([
    row('moon.md', 'Moon landing', '1969-07-20'),
    row('apollo.md', 'Apollo 11', '1969-07-16', '1969-07-24'),
    row('war.md', 'Thirty Years War', '1618', '1648'),
    row('woodstock.md', 'Woodstock', '1969-08'),
    row('typo.md', 'Typo', '1970-05-01', '1969-01-01'),
    row('bad-end.md', 'Bad end', '1970-05-01', 'soon'),
    row('none.md', 'Someday', null),
    row('bad.md', 'Bad date', '1969-02-30'),
    row('far.md', 'Far future', '+200000-01-01'),
  ]);
  const ev = (k: string) => m.dated.find((e) => e.key === k)!;

  it('names each event and its dates, a bar\'s with its end', () => {
    expect(ev('moon.md').label).toBe('Moon landing, 20 July 1969');
    expect(norm(ev('apollo.md').label)).toBe('Apollo 11, 16 – 24 July 1969');
    expect(ev('moon.md').ranged).toBe(false);
    expect(ev('apollo.md').ranged).toBe(true);
    expect(ev('apollo.md').end).toBe(civilMs(1969, 6, 25)); // an end day is inclusive
  });

  it('a partial date is its whole span, hatched; a full date is certain', () => {
    expect(ev('woodstock.md')).toMatchObject({ start: civilMs(1969, 7, 1), end: civilMs(1969, 8, 1), approx: true });
    expect(ev('woodstock.md').segments).toEqual([{ start: civilMs(1969, 7, 1), end: civilMs(1969, 8, 1), approx: true }]);
    expect(ev('moon.md').approx).toBe(false);
    // 1618–1648: the first and last years are uncertain, the years between certain.
    expect(ev('war.md').segments).toEqual([
      { start: civilMs(1618, 0, 1), end: civilMs(1619, 0, 1), approx: true },
      { start: civilMs(1619, 0, 1), end: civilMs(1648, 0, 1), approx: false },
      { start: civilMs(1648, 0, 1), end: civilMs(1649, 0, 1), approx: true },
    ]);
  });

  it('a backwards or unreadable end keeps the event at its start, flagged — not undated', () => {
    expect(ev('typo.md')).toMatchObject({ start: civilMs(1970, 4, 1), end: civilMs(1970, 4, 2), ranged: false });
    expect(ev('typo.md').endNote).toBe('End date ignored: 1969-01-01 is before the start');
    expect(ev('typo.md').label).toBe('Typo, 1 May 1970 (end date ignored)');
    expect(ev('bad-end.md').endNote).toBe("End date ignored: couldn't read 'soon'");
    expect(ev('moon.md').endNote).toBeNull();
  });

  it('sends the undated to the tray with a reason', () => {
    expect(m.undated.map((u) => [u.key, u.reason, u.reasonText])).toEqual([
      ['none.md', 'missing', 'No date'],
      ['bad.md', 'invalid', "Couldn't read the date '1969-02-30'"],
      ['far.md', 'out-of-range', "Outside the timeline's range (+200000-01-01)"],
    ]);
  });

  it('reports the dated extent', () => {
    expect(m.extent).toEqual({ start: civilMs(1618, 0, 1), end: civilMs(1970, 4, 2) });
    expect(build([row('x.md', 'x', null)]).extent).toBeNull();
  });

  it('orders a day\'s clock times within it, from `datetime` values', () => {
    const day = build([
      row('b.md', 'Lunch', '2026-10-05T12:30'),
      row('a.md', 'Standup', '2026-10-05T09:00', '2026-10-05T09:15'),
      row('c.md', 'All day', '2026-10-05'),
    ]);
    expect(timeOrder(day.dated)).toEqual(['c.md', 'a.md', 'b.md']);
    expect(day.dated.find((e) => e.key === 'a.md')!.end).toBe(civilMs(2026, 9, 5, 9, 15));
  });
});

describe('segmentsOf', () => {
  it('hatches throughout when an end narrows within the start\'s span', () => {
    const s = dateSpan('1969')!;
    const e = dateSpan('1969-03')!;
    expect(segmentsOf(s.start, e.end, s, e)).toEqual([{ start: s.start, end: e.end, approx: true }]);
  });
});

describe('layoutTimeline', () => {
  const pxPerMs = 1000 / (civilMs(1971, 0, 1) - civilMs(1969, 0, 1)); // 1000px for two years

  it('a span narrower than the marker is a point; a wider one a bar', () => {
    const m = build([row('d.md', 'A day', '1969-07-20'), row('y.md', 'A year', '1969')]);
    const l = layoutTimeline(m.dated, pxPerMs);
    expect(l.placements.get('d.md')!.point).toBe(true); // ~1.4px
    expect(l.placements.get('y.md')!.point).toBe(false); // ~500px
    expect(MARKER_PX).toBeGreaterThan(1.4);
  });

  it('overlapping events take separate lanes; distant ones share', () => {
    const m = build([
      row('a.md', 'A', '1969-01', '1969-06'),
      row('b.md', 'B', '1969-03', '1969-09'),
      row('c.md', 'C', '1970-06', '1970-07'),
    ]);
    const l = layoutTimeline(m.dated, pxPerMs);
    expect(l.placements.get('a.md')!.lane).toBe(0);
    expect(l.placements.get('b.md')!.lane).toBe(1);
    expect(l.placements.get('c.md')!.lane).toBe(0);
    expect(l.laneCount).toBe(2);
  });

  it('is deterministic whatever order the instances arrive in', () => {
    const rows = [row('a.md', 'Same', '1969-07-20'), row('b.md', 'Same', '1969-07-20'), row('c.md', 'Other', '1969-07-20')];
    const one = layoutTimeline(build(rows).dated, pxPerMs);
    const two = layoutTimeline(build([...rows].reverse()).dated, pxPerMs);
    expect([...two.placements.entries()].sort()).toEqual([...one.placements.entries()].sort());
    expect(timeOrder(build(rows).dated)).toEqual(['c.md', 'a.md', 'b.md']); // start, end, title, key
  });

  it('a label outside the mark keeps the next event in its lane clear of it', () => {
    // Two points 20px apart: their labels would overlap, so they stack.
    const m = build([row('a.md', 'A long title here', '1969-07-01'), row('b.md', 'B', '1969-07-15')]);
    const l = layoutTimeline(m.dated, pxPerMs);
    expect(l.placements.get('b.md')!.lane).toBe(1);
    // Zoomed out, the same two share nothing — lanes follow the zoom.
    const far = build([row('a.md', 'A', '1969-07-01'), row('b.md', 'B', '1970-07-15')]);
    expect(layoutTimeline(far.dated, pxPerMs).laneCount).toBe(1);
  });

  it('puts a label inside a bar\'s solid stretch when it fits, and never on the hatch', () => {
    const m = build([
      row('s.md', 'Solid', '1969-01-01', '1970-12-31'),
      row('h.md', 'Hatched', '1969', '1970'),
      row('p.md', 'Partly', '1969', '1970-12-31'), // hatched 1969, solid 1970
    ]);
    const l = layoutTimeline(m.dated, pxPerMs);
    expect(l.placements.get('s.md')!.labelIn).toEqual({ start: civilMs(1969, 0, 1), end: civilMs(1971, 0, 1) });
    expect(l.placements.get('h.md')!.labelIn).toBeNull();
    expect(l.placements.get('p.md')!.labelIn).toEqual({ start: civilMs(1970, 0, 1), end: civilMs(1971, 0, 1) });
  });

  it('Fit leaves room for the latest events\' labels', () => {
    const m = build([row('a.md', 'Early', '1900'), row('b.md', 'A late label', '1999')]);
    expect(trailingLabelRoom(m.dated, m.extent!.end, m.extent!.end - m.extent!.start)).toBeGreaterThan(labelWidth('A late label'));
    expect(trailingLabelRoom([], 0, 1)).toBe(0);
  });

  it('shortens a long label', () => {
    expect(shortLabel('x'.repeat(100))).toHaveLength(MAX_LABEL_CHARS);
    expect(shortLabel('short')).toBe('short');
  });
});

describe('cullToView', () => {
  it('keeps what meets the view (with overscan) and the lanes in view, plus the tab stop', () => {
    const rows = Array.from({ length: 30 }, (_, i) => row(`e${i}.md`, `E${i}`, `${1900 + i * 4}-01-01`));
    const m = build(rows);
    const l = layoutTimeline(m.dated, 1000 / (civilMs(2020, 0, 1) - civilMs(1900, 0, 1)));
    const view = { start: civilMs(1960, 0, 1), end: civilMs(1970, 0, 1) };
    const kept = cullToView(m.dated, l, view, { first: 0, last: 100 }, 'e0.md').map((e) => e.key);
    expect(kept).toContain('e0.md'); // 1900: far outside, but it's the tab stop
    expect(kept).toContain('e15.md'); // 1960
    expect(kept).toContain('e14.md'); // 1956: within half a screen
    expect(kept).not.toContain('e13.md'); // 1952: past it
    expect(kept).not.toContain('e5.md'); // 1920
    expect(cullToView(m.dated, l, view, { first: 5, last: 9 }, null).every((e) => (l.placements.get(e.key)!.lane >= 5))).toBe(true);
  });
});
