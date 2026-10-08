/**
 * What an exported Timeline draws (#2609): only the events meeting the
 * range, in at most `EXPORT_MAX_LANES` lanes, the rest named as overflow, and
 * every event in range listed in time order.
 */
import { describe, it, expect } from 'vitest';
import { civilMs } from '../../../../src/shared/objects/date-precision';
import { buildTimelineModel } from '../../../../src/renderer/lib/components/timeline/timeline-events';
import { EXPORT_MAX_LANES, planTimelineExport } from '../../../../src/renderer/lib/components/timeline/timeline-export';

const row = (path: string, title: string, date: string | null, end: string | null = null) =>
  ({ path, title, values: { date, end }, cover: null });
/** Event's start and end (`timelineProperties` for a view dated by `date`). */
const EVENT = { dateProperty: 'date', endProperty: 'end' };
const range = (from: number, to: number) => ({ start: civilMs(from, 0, 1), end: civilMs(to, 0, 1) });

describe('planTimelineExport', () => {
  it('lays out only the events meeting the range, and counts the rest as outside', () => {
    const m = buildTimelineModel([
      row('moon.md', 'Moon landing', '1969-07-20'),
      row('war.md', 'Thirty Years War', '1618', '1648'),
      row('decade.md', 'The sixties', '1960', '1969'),
    ], { ...EVENT, locale: 'en-GB' });
    const plan = planTimelineExport(m.dated, range(1965, 1975), 760);
    expect(plan.drawn.map((e) => e.key).sort()).toEqual(['decade.md', 'moon.md']);
    expect(plan.listed.map((e) => e.key)).toEqual(['decade.md', 'moon.md']); // time order
    expect(plan.layout.placements.has('war.md')).toBe(false);
    expect(plan.outside).toBe(1);
    expect(plan.overflow).toEqual([]);
  });

  it(`caps the drawing at ${EXPORT_MAX_LANES} lanes; the rest are overflow, in time order, and still listed`, () => {
    // 35 events over the same week: one lane each.
    const rows = Array.from({ length: 35 }, (_, i) => row(`e${String(i).padStart(2, '0')}.md`, `E${String(i).padStart(2, '0')}`, '1969-07-16', '1969-07-24'));
    const m = buildTimelineModel(rows, { ...EVENT, locale: 'en-GB' });
    const plan = planTimelineExport(m.dated, { start: civilMs(1969, 6, 1), end: civilMs(1969, 7, 1) }, 760);
    expect(plan.layout.laneCount).toBe(35);
    expect(plan.laneCount).toBe(EXPORT_MAX_LANES);
    expect(plan.drawn).toHaveLength(30);
    expect(plan.overflow.map((e) => e.title)).toEqual(['E30', 'E31', 'E32', 'E33', 'E34']);
    expect(plan.listed).toHaveLength(35);
    for (const ev of plan.drawn) expect(plan.layout.placements.get(ev.key)!.lane).toBeLessThan(EXPORT_MAX_LANES);
  });

  it('throws on a range it cannot draw, so the caller lists instead', () => {
    const m = buildTimelineModel([row('moon.md', 'Moon landing', '1969-07-20')], EVENT);
    expect(() => planTimelineExport(m.dated, { start: 5, end: 5 }, 760)).toThrow();
    expect(() => planTimelineExport(m.dated, range(1960, 1970), 0)).toThrow();
  });
});
