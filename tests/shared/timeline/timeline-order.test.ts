/**
 * A timeline's range order (#2942): what ⇧-click selects across and Export
 * CSV writes — dated by start (then end, title), then Undated in the tray's
 * order.
 */
import { describe, it, expect } from 'vitest';
import { buildTimelineModel, timelineOrder } from '../../../src/shared/timeline/timeline-events';

const row = (path: string, date: string | null, end: string | null = null) =>
  ({ path, title: path.replace('.md', ''), values: { date, end } });
const PROPS = { dateProperty: 'date', endProperty: 'end' };

describe('timelineOrder (#2942)', () => {
  it('by start, then end, then title; Undated last, as the tray lists them', () => {
    const model = buildTimelineModel([
      row('nodate.md', null),
      row('moon.md', '1969-07-20'),
      row('apollo.md', '1961', '1972'),
      row('b-same.md', '1969-07-20'),
      row('garbled.md', 'whenever'),
      row('long.md', '1969-07-20', '1969-12-31'),
    ], PROPS);
    expect(timelineOrder(model).map((i) => i.path)).toEqual([
      'apollo.md', 'b-same.md', 'moon.md', 'long.md', 'nodate.md', 'garbled.md',
    ]);
  });
});
