/**
 * @vitest-environment node
 *
 * The Events sample thoughtbase (`pnpm sample:events`) read back through the
 * app's own frontmatter parser, timeline and calendar models, and embed
 * parser: each edge case its notes claim to exercise is the one Minerva
 * actually sees, so the sample can't drift into testing nothing.
 */
import { describe, it, expect } from 'vitest';
import { eventsThoughtbase } from '../../scripts/lib/events-thoughtbase.mjs';
import { parseFrontmatter } from '../../src/shared/frontmatter-parse';
import { buildTimelineModel } from '../../src/shared/timeline/timeline-events';
import { buildCalendarModel } from '../../src/shared/calendar/calendar-model';
import { isViewLayout } from '../../src/shared/objects/view-layouts';
import { parseViewFilters } from '../../src/shared/objects/view-spec';
import type { TypeInstanceRow } from '../../src/shared/objects/type-def';

const TODAY = new Date(2026, 10, 1); // 1 November 2026, a Sunday
const files = eventsThoughtbase(TODAY);

const events: TypeInstanceRow[] = Object.entries(files).flatMap(([path, content]) => {
  const fm = parseFrontmatter(content);
  if (fm.type !== 'event' && fm.type !== 'meeting') return [];
  const values: Record<string, string> = {};
  for (const k of ['date', 'end'] as const) {
    const v = fm[k];
    if (typeof v === 'string') values[k] = v;
  }
  const title = /^# (.+)$/m.exec(content)![1]!;
  return [{ path, title, values } as TypeInstanceRow];
});
const opts = { dateProperty: 'date', endProperty: 'end', locale: 'en-US' };
const timeline = buildTimelineModel(events, opts);
const byTitle = new Map(timeline.dated.map((e) => [e.title, e]));

describe('the Events sample thoughtbase', () => {
  it('keeps every date a string in YAML, years and BC dates included', () => {
    for (const content of Object.values(files)) {
      const fm = parseFrontmatter(content);
      for (const k of ['date', 'end']) if (k in fm) expect(typeof fm[k]).toBe('string');
    }
  });

  it('sends exactly the three notes meant for it to the Undated tray, for their reasons', () => {
    expect(Object.fromEntries(timeline.undated.map((u) => [u.title, u.reason]))).toEqual({
      'Typo Date': 'invalid', 'Someday Hike': 'missing', 'Big Bang': expect.stringMatching(/out-of-range|invalid/),
    });
  });

  it('has the bars, the approximate dates and the ignored end it describes', () => {
    expect(byTitle.get('Lisbon Offsite')!.ranged).toBe(true);
    expect(byTitle.get('Conference')!.ranged).toBe(true);
    expect(byTitle.get('Reign of Augustus')!.ranged).toBe(true);
    expect(byTitle.get('Printing Press')!.approx).toBe(true);
    expect(byTitle.get('Product Launch')!.segments.some((s) => s.approx)).toBe(true);
    expect(byTitle.get('Backwards Workshop')!.endNote).not.toBeNull();
    expect(byTitle.get('Backwards Workshop')!.ranged).toBe(false);
  });

  it('puts the coarse dates in the calendar\'s bands and the crowded day in the grid', () => {
    const cal = buildCalendarModel(events, opts);
    expect(cal.month.map((e) => e.title)).toEqual(['Quarterly Planning']);
    expect(cal.year.map((e) => e.title).sort()).toEqual(['Annual Retreat', 'Printing Press']);
    expect(Object.keys(files).filter((p) => p.startsWith('events/busy/'))).toHaveLength(7);
    // Today, a Sunday, has its three timed events, and the offsite runs Thursday to Monday.
    expect(Object.keys(files).filter((p) => files[p]!.includes('date: "2026-11-01T'))).toHaveLength(3);
    expect(files['events/Lisbon Offsite.md']).toContain('date: "2026-11-12"');
    expect(files['events/Lisbon Offsite.md']).toContain('end: "2026-11-16"');
  });

  it('every saved view is a layout spec, with filters that survive parsing', () => {
    const specOf = (content: string) => JSON.parse(/```object-view\n([\s\S]*?)\n```/.exec(content)![1]!) as Record<string, unknown>;
    const views = Object.entries(files).filter(([p]) => p.startsWith('Views/')).map(([, c]) => specOf(c));
    expect(views).toHaveLength(8);
    for (const spec of views) {
      expect(isViewLayout(spec.layout)).toBe(true);
      expect(spec.typeId).toBe(spec.layout === 'kanban' ? 'project' : 'event');
      if (spec.filters) expect(parseViewFilters(spec.filters)).toEqual(spec.filters);
    }
    expect(specOf(files['Views/Calendar - Next Month.md']).month).toBe('2026-12');
  });

  it('fills a Project board: every status, an off-list value and an empty one', () => {
    const statuses = Object.entries(files).filter(([p]) => p.startsWith('projects/'))
      .map(([, c]) => { const v = parseFrontmatter(c).status; return typeof v === 'string' ? v : ''; });
    expect(statuses.sort()).toEqual(['', 'abandoned', 'active', 'active', 'blocked', 'done', 'done', 'paused']);
  });

  it('handles a last-of-month today without spilling the crowded day into next month', () => {
    const late = eventsThoughtbase(new Date(2026, 0, 31));
    expect(late['events/busy/Coffee Chat.md']).toContain('date: "2026-01-29T08:00"');
  });
});
