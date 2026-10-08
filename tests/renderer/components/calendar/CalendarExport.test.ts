/**
 * @vitest-environment happy-dom
 *
 * The Calendar in export mode (#2704): `TypeViewCalendar` with `exportMode`
 * draws `CalendarExportGrid` — the spec's month, static (no navigation, tab
 * stops, hover, popover or today ring), every event listed in its day's cell
 * (bars across their columns, single days one per line), every event a
 * `data-note-path` the snapshot links, the bands and Undated tray after the
 * grid, a legend when anything is hatched, rows that don't split across a
 * printed page, and a list in place of the grid when it can't be planned.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/svelte';
import TypeViewCalendar from '../../../../src/renderer/lib/components/TypeViewCalendar.svelte';
import { civilMs } from '../../../../src/shared/objects/date-precision';
import type { TypeInstanceRow } from '../../../../src/shared/objects/type-def';
import { silenceLogTags } from '../../../helpers/quiet-logs';

const settings = vi.hoisted(() => ({ weekStart: 1, showWeekNumbers: false }));
vi.mock('../../../../src/renderer/lib/stores/settings-calendar.svelte', () => ({
  getCalendarSettings: () => ({
    get weekStart() { return settings.weekStart; },
    get showWeekNumbers() { return settings.showWeekNumbers; },
  }),
}));
const planner = vi.hoisted(() => ({ fail: false }));
vi.mock('../../../../src/renderer/lib/components/calendar/calendar-export', async (orig) => {
  const real = await orig<typeof import('../../../../src/renderer/lib/components/calendar/calendar-export')>();
  return {
    ...real,
    planCalendarExport: (...args: Parameters<typeof real.planCalendarExport>) => {
      if (planner.fail) throw new Error('boom');
      return real.planCalendarExport(...args);
    },
  };
});

const EVENT = {
  id: 'event', label: 'Event', classLocalName: 'Event', icon: '📅', source: 'stock' as const,
  properties: [
    { name: 'date', type: 'datetime' as const },
    { name: 'end', type: 'datetime' as const },
  ],
};
const row = (p: string, title: string, date: string | null, end: string | null = null): TypeInstanceRow =>
  ({ path: p, title, values: { date, end }, cover: null });

const LONG = 'The quarterly planning review with every regional lead and the finance team';
// October 2026, Monday start: rows 28 Sep–4 Oct, 5–11, 12–18, 19–25, 26 Oct–1 Nov.
const EVENTS = [
  row('dentist.md', 'Dentist', '2026-10-06'),
  row('standup.md', 'Standup', '2026-10-07T09:00:00'),
  row('long.md', LONG, '2026-10-07'),
  row('trip.md', 'Trip', '2026-10-09', '2026-10-14'),
  row('launch.md', 'Launch', '2026-10-20', '2026-11'),
  row('octfest.md', 'Octfest', '2026-10'),
  row('year.md', 'The year', '2026'),
  row('someday.md', 'Someday', null),
];
const BUSY = Array.from({ length: 9 }, (_, i) => row(`busy-${i}.md`, `Busy ${i}`, `2026-10-15T${String(8 + i).padStart(2, '0')}:00:00`));

const day = (y: number, m: number, d: number) => civilMs(y, m - 1, d);

function setup(over: Record<string, unknown> = {}) {
  const utils = render(TypeViewCalendar, {
    type: EVENT,
    properties: EVENT.properties,
    instances: EVENTS,
    month: '2026-10',
    display: (_p: unknown, v: string | null) => v ?? '',
    rowType: () => EVENT,
    onOpenNote: vi.fn(),
    onStateChange: vi.fn(),
    locale: 'en-GB',
    weekStart: 1,
    exportMode: true,
    ...over,
  });
  const q = (sel: string) => utils.container.querySelector<HTMLElement>(sel);
  const cell = (ms: number) => q(`[role="cell"][data-day="${ms}"]`)!;
  const evs = (p: string) => [...utils.container.querySelectorAll<HTMLElement>(`[data-calendar-event][data-note-path="${p}"]`)];
  return { ...utils, q, cell, evs };
}

beforeEach(() => { settings.weekStart = 1; settings.showWeekNumbers = false; planner.fail = false; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the exported month', () => {
  it('is the spec\'s month as a static table: no navigation, tab stops, grid role, popover or hover', () => {
    const { container, q } = setup();
    expect(q('.cal-title')!.textContent).toBe('October 2026');
    expect(q('[role="table"]')!.getAttribute('aria-label')).toBe('October 2026');
    expect(q('[role="table"]')!.dataset['month']).toBe('2026-10');
    expect(q('[role="grid"]')).toBeNull();
    expect(container.querySelectorAll('[role="cell"]')).toHaveLength(35);
    expect(screen.queryByRole('button', { name: 'Next month' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Today' })).toBeNull();
    expect(container.querySelectorAll('[tabindex]')).toHaveLength(0);
    expect(container.querySelector('.cal-more, [role="dialog"], [role="tooltip"]')).toBeNull();
  });

  it('a spec with no month exports the current month', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2027, 2, 3, 12, 0));
    const { q } = setup({ month: null });
    expect(q('.cal-title')!.textContent).toBe('March 2027');
    expect(q('[role="table"]')!.dataset['month']).toBe('2027-03');
  });

  it('doesn\'t ring today: a printed page outlives the day it was made', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0));
    const { container } = setup({ month: null });
    expect(container.querySelector('[aria-current]')).toBeNull();
  });

  it('names each day with its count for a screen reader, and dims the neighbouring months', () => {
    const { cell } = setup();
    expect(cell(day(2026, 10, 7)).textContent).toContain('Wednesday, 7 October 2026, 2 events');
    expect(cell(day(2026, 10, 10)).textContent).toContain('Saturday, 10 October 2026, 1 event'); // the Trip bar covers it
    expect(cell(day(2026, 9, 28)).classList.contains('calx-out')).toBe(true);
    expect(cell(day(2026, 10, 1)).classList.contains('calx-out')).toBe(false);
  });

  it('takes the week start and week numbers it is given (the per-machine settings by default)', () => {
    settings.weekStart = 7;
    settings.showWeekNumbers = true;
    const { q, container } = setup({ weekStart: undefined });
    expect(q('[role="table"]')!.dataset['weekStart']).toBe('7');
    expect(q('[role="cell"]')!.dataset['day']).toBe(String(day(2026, 9, 27)));
    expect([...container.querySelectorAll('[role="rowheader"]')].map((h) => h.textContent)).toEqual(['40', '41', '42', '43', '44']);
  });
});

describe('every event in its day\'s cell', () => {
  it('a busy day lists all its events, in time order, with no "+N more"', () => {
    const { cell, evs, container } = setup({ instances: BUSY });
    const listed = [...cell(day(2026, 10, 15)).querySelectorAll<HTMLElement>('[data-calendar-event]')];
    expect(listed.map((e) => e.dataset['notePath'])).toEqual(BUSY.map((b) => b.path));
    expect(evs('busy-0.md')[0]!.textContent).toBe('8:00 Busy 0');
    expect(container.querySelector('.cal-more')).toBeNull();
  });

  it('a long title is printed whole', () => {
    const { cell } = setup();
    expect(cell(day(2026, 10, 7)).textContent).toContain(LONG);
  });

  it('a multi-day event is a bar cut at each row, with continuation marks', () => {
    const { evs, cell } = setup();
    const [a, b] = evs('trip.md');
    expect(evs('trip.md')).toHaveLength(2);
    expect(cell(day(2026, 10, 9)).contains(a!)).toBe(true);
    expect(a!.style.getPropertyValue('--span')).toBe('3');
    expect(a!.classList.contains('calx-cont-after')).toBe(true);
    expect(cell(day(2026, 10, 12)).contains(b!)).toBe(true);
    expect(b!.classList.contains('calx-cont-before')).toBe(true);
    expect(b!.textContent).toContain('‹');
  });

  it('an end coarser than the start is hatched, and the legend says what that means', () => {
    const { evs, q } = setup();
    // 20 Oct – "November": the row holding 1 November is hatched from there.
    const segs = evs('launch.md');
    expect(segs.map((s) => s.querySelector('.calx-hatch') !== null)).toEqual([false, true]);
    expect(q('.calx-legend')!.textContent).toContain('approximate');
  });

  it('no legend when nothing hatched is drawn', () => {
    const { q } = setup({ instances: BUSY });
    expect(q('.calx-legend')).toBeNull();
  });

  it('every event, band entry and Undated row carries its note path for the snapshot to link', () => {
    const { container } = setup();
    const paths = new Set([...container.querySelectorAll<HTMLElement>('[data-note-path]')].map((e) => e.dataset['notePath']));
    expect([...paths].sort()).toEqual(EVENTS.map((e) => e.path).sort());
  });
});

describe('around the grid', () => {
  it('the month and year bands, then the Undated tray, follow the grid', () => {
    const { q } = setup();
    const grid = q('[role="table"]')!;
    const year = q('[data-band="year"]')!;
    const month = q('[data-band="month"]')!;
    const undated = q('.cal-undated')!;
    const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    expect(after(grid, year)).toBe(true);
    expect(after(year, month)).toBe(true);
    expect(after(month, undated)).toBe(true);
    expect(year.textContent).toContain('The year');
    expect(month.textContent).toContain('Octfest');
    expect(undated.textContent).toContain('Someday');
  });

  it('the bands are laid out after the grid on the page too, not lifted above it', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../../../src/renderer/lib/components/calendar/CalendarBands.svelte'), 'utf-8');
    expect(css).toMatch(/\.cal-bands-export\s*\{[^}]*order:\s*0/);
  });

  it('a week row never splits across a printed page', () => {
    const css = fs.readFileSync(path.join(__dirname, '../../../../src/renderer/lib/components/calendar/CalendarExportGrid.svelte'), 'utf-8');
    expect(css).toMatch(/\.calx-week\s*\{[^}]*break-inside:\s*avoid/);
  });
});

describe('when the grid can\'t be drawn', () => {
  silenceLogTags('objects');

  it('lists the month\'s events instead, linked — never the raw spec', () => {
    planner.fail = true;
    const { q, container } = setup();
    expect(q('[role="table"]')).toBeNull();
    expect(q('.calx-fallback')!.textContent).toContain("couldn't be drawn");
    const listed = [...container.querySelectorAll<HTMLElement>('.calx-fallback-title')].map((e) => e.dataset['notePath']);
    expect(listed).toEqual(['dentist.md', 'long.md', 'standup.md', 'trip.md', 'launch.md']);
    expect(container.textContent).not.toContain('typeId');
  });
});
