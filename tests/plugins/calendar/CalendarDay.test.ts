/**
 * @vitest-environment happy-dom
 *
 * The Calendar's Day view (#2952, epic #2949): the week's grid with one
 * column, each event's second line (its first card field that isn't a date),
 * stepping by day and past the column's edge, Week ↔ Day keeping `date`, a
 * day opened from Month and from Week (a double-click on its number, or
 * Alt+Enter), and the agenda beside the grid.
 *
 * happy-dom has no layout, so the container query that hides the agenda at
 * narrow widths never applies here: the agenda is always in the DOM.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, cleanup, screen } from '@testing-library/svelte';
import { renderCalendar, type CalendarProps } from './fixtures';
import { civilMs } from '../../../src/shared/objects/date-precision';
import { dayName } from '../../../src/shared/calendar/calendar-model';
import type { TypeInstanceRow } from '../../../src/shared/objects/type-def';

const EVENT = {
  id: 'event', label: 'Event', icon: '📅', color: '#89b4fa',
  properties: [{ name: 'date', type: 'datetime' }, { name: 'end', type: 'datetime' }, { name: 'room', type: 'text' }],
};
const row = (path: string, title: string, date: string | null, end: string | null = null): TypeInstanceRow =>
  ({ path, title, values: { date, end }, cover: null });

// "Today" is Wednesday 7 October 2026, in a Monday-start week of 5–11 October.
const EVENTS = [
  row('holiday.md', 'Holiday', '2026-10-07'),
  row('review.md', 'Design review', '2026-10-07T09:00', '2026-10-07T11:00'),
  row('oneone.md', '1:1 with Ann', '2026-10-07T09:30', '2026-10-07T10:30'),
  row('call.md', 'Call', '2026-10-08T11:00'),
];
// Minerva sends a note's card fields with the date among them: the second line skips it.
const FIELDS = {
  'review.md': [{ name: 'date', label: 'Date', text: '7 Oct 2026, 9:00' }, { name: 'room', label: 'Room', text: 'Blue' }],
  'call.md': [{ name: 'room', label: 'Room', text: 'Phone' }],
};
const day = (y: number, m: number, d: number) => civilMs(y, m - 1, d);
const TODAY = day(2026, 10, 7);
const LOCALE = 'en-GB';

function setup(over: Partial<CalendarProps> = {}) {
  const utils = renderCalendar({
    type: EVENT, properties: EVENT.properties, instances: EVENTS, fields: FIELDS,
    mode: 'day', date: '2026-10-07', locale: LOCALE, weekStart: 1, ...over,
  });
  const q = (sel: string) => utils.container.querySelector<HTMLElement>(sel);
  const qa = (sel: string) => [...utils.container.querySelectorAll<HTMLElement>(sel)];
  const title = () => q('.cal-title')!.textContent.trim();
  const ev = (path: string) => q(`.wk [data-calendar-event][data-note-path="${path}"]`);
  return { ...utils, q, qa, title, ev };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 7, 10, 15));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the Day view (#2952)', () => {
  it('is one column, titled with the day, its events by the hour and side by side', () => {
    const s = setup();
    expect(s.title()).toBe(dayName(TODAY, LOCALE));
    expect(s.qa('.wk [role="columnheader"]').slice(1).map((h) => h.getAttribute('aria-label'))).toEqual([dayName(TODAY, LOCALE)]);
    expect(s.ev('review.md')!.dataset).toMatchObject({ startMin: '540', endMin: '660', lane: '0', lanes: '2' });
    expect(s.ev('oneone.md')!.dataset).toMatchObject({ startMin: '570', endMin: '630', lane: '1', lanes: '2' });
    expect(s.q('.wk-allday [data-note-path="holiday.md"]')).not.toBeNull();
    expect(s.ev('call.md')).toBeNull(); // tomorrow's
  });

  it('a tall enough event shows its first card field that isn\'t a date as a second line', () => {
    const s = setup();
    expect(s.ev('review.md')!.querySelector('.wk-detail')?.textContent).toBe('Room: Blue');
    expect(s.ev('oneone.md')!.querySelector('.wk-detail')).toBeNull(); // no fields
  });

  it('the week shows no second line', () => {
    const s = setup({ mode: 'week' });
    expect(s.ev('review.md')!.querySelector('.wk-detail')).toBeNull();
  });

  it('‹ and › step a day and write `date`; Today writes it unset', async () => {
    const s = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Next day' }));
    expect(s.onStateChange).toHaveBeenLastCalledWith({ date: '2026-10-08' });
    expect(s.title()).toBe(dayName(day(2026, 10, 8), LOCALE));
    expect(s.ev('call.md')).not.toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Previous day' }));
    expect(s.onStateChange).toHaveBeenLastCalledWith({ date: '2026-10-06' });
    await fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(s.onStateChange).toHaveBeenLastCalledWith({ date: null });
    expect(s.title()).toBe(dayName(TODAY, LOCALE));
  });

  it('←/→ past the column go to the previous and next day, keeping the slot', async () => {
    const s = setup();
    const cell = s.q(`[role="gridcell"][data-day="${TODAY}"][data-slot="18"]`)!;
    cell.focus();
    await fireEvent.keyDown(cell, { key: 'ArrowRight' });
    expect(s.onStateChange).toHaveBeenLastCalledWith({ date: '2026-10-08' });
    expect(document.activeElement).toBe(s.q(`[role="gridcell"][data-day="${day(2026, 10, 8)}"][data-slot="18"]`));
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(s.onStateChange).toHaveBeenLastCalledWith({ date: '2026-10-06' });
    expect(s.title()).toBe(dayName(day(2026, 10, 6), LOCALE));
  });

  it('Alt+Enter in the Day view itself opens nothing new', async () => {
    const s = setup();
    const cell = s.q(`[role="gridcell"][data-day="${TODAY}"][data-slot="18"]`)!;
    cell.focus();
    s.onStateChange.mockClear();
    await fireEvent.keyDown(cell, { key: 'Enter', altKey: true });
    expect(s.onStateChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('switching to and from Day (#2952)', () => {
  it('Week ↔ Day keeps `date`, and writes only `mode`', async () => {
    const s = setup({ mode: 'week', date: '2026-10-09' });
    await fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    expect(s.onStateChange).toHaveBeenLastCalledWith({ mode: 'day' });
    expect(s.title()).toBe(dayName(day(2026, 10, 9), LOCALE));
    expect(screen.getByRole('button', { name: 'Day' }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(s.onStateChange).toHaveBeenLastCalledWith({ mode: 'week' });
    expect(s.title().replace(/\s+/g, ' ')).toBe('5 – 11 October 2026'); // the locale's range format uses thin spaces
    expect(s.q('.wk')!.style.getPropertyValue('--cols')).toBe('7');
  });

  it('a month following today opens today with `date` unwritten; an explicit month its 1st', async () => {
    let s = setup({ mode: null, date: null, month: null });
    await fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    expect(s.onStateChange).toHaveBeenLastCalledWith({ mode: 'day', date: null });
    expect(s.title()).toBe(dayName(TODAY, LOCALE));
    cleanup();
    s = setup({ mode: null, date: null, month: '2026-12' });
    await fireEvent.click(screen.getByRole('button', { name: 'Day' }));
    expect(s.onStateChange).toHaveBeenLastCalledWith({ mode: 'day', date: '2026-12-01' });
  });

  it('Day → Month opens the day\'s month', async () => {
    const s = setup({ date: '2026-11-20' });
    await fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(s.onStateChange).toHaveBeenLastCalledWith({ mode: null, month: '2026-11' });
  });
});

describe('opening a day from Month and Week (#2952)', () => {
  it('a double-click on a month day\'s number opens it', async () => {
    const s = setup({ mode: null, date: null, month: null });
    const num = s.q(`[role="grid"][data-month] [role="gridcell"][data-day="${day(2026, 10, 9)}"] .cal-num`)!;
    await fireEvent.dblClick(num);
    expect(s.onStateChange).toHaveBeenLastCalledWith({ mode: 'day', date: '2026-10-09' });
    expect(s.title()).toBe(dayName(day(2026, 10, 9), LOCALE));
  });

  it('Alt+Enter on a focused month day opens it; today, from a month following today, follows today', async () => {
    const s = setup({ mode: null, date: null, month: null });
    const cell = s.q(`[role="grid"][data-month] [role="gridcell"][data-day="${TODAY}"]`)!;
    cell.focus();
    await fireEvent.keyDown(cell, { key: 'Enter', altKey: true });
    expect(s.onStateChange).toHaveBeenLastCalledWith({ mode: 'day', date: null });
    expect(screen.queryByRole('dialog')).toBeNull(); // not the day's list
  });

  it('a double-click on a week column\'s number, or Alt+Enter on a cell, opens that day', async () => {
    let s = setup({ mode: 'week', date: '2026-10-07' });
    const heads = s.qa('.wk-colhead .wk-num');
    await fireEvent.dblClick(heads[3]!); // Thursday the 8th
    expect(s.onStateChange).toHaveBeenLastCalledWith({ mode: 'day', date: '2026-10-08' });
    cleanup();
    s = setup({ mode: 'week', date: '2026-10-07' });
    const cell = s.q(`[role="gridcell"][data-day="${day(2026, 10, 10)}"][data-slot="20"]`)!;
    cell.focus();
    await fireEvent.keyDown(cell, { key: 'Enter', altKey: true });
    expect(s.onStateChange).toHaveBeenLastCalledWith({ mode: 'day', date: '2026-10-10' });
  });
});

describe('the agenda (#2952)', () => {
  const agendaItems = () => [...document.querySelectorAll<HTMLElement>('[data-calendar-agenda] [data-agenda-event]')];

  it('lists the day\'s events in order, all-day first, with their second line', () => {
    setup();
    expect(screen.getByRole('region', { name: `Agenda, ${dayName(TODAY, LOCALE)}` })).not.toBeNull();
    expect(agendaItems().map((e) => e.dataset['notePath'])).toEqual(['holiday.md', 'review.md', 'oneone.md']);
    expect(agendaItems()[1]!.querySelector('.cal-agenda-detail')?.textContent).toBe('Room: Blue');
    expect(agendaItems()[0]!.querySelector('.cal-agenda-time')?.textContent).toBe('All day');
  });

  it('is one tab stop: ↑/↓ move, a click opens', async () => {
    const s = setup();
    const items = agendaItems();
    expect(items.map((e) => e.tabIndex)).toEqual([0, -1, -1]);
    items[0]!.focus();
    await fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    await fireEvent.keyDown(items[1]!, { key: 'End' });
    expect(document.activeElement).toBe(items[2]);
    expect(items.map((e) => e.tabIndex)).toEqual([-1, -1, 0]);
    await fireEvent.click(items[1]!);
    expect(s.onOpenNote).toHaveBeenCalledWith('review.md');
  });

  it('a day with nothing says so; the week has no agenda', () => {
    setup({ date: '2026-10-20' });
    expect(document.querySelector('[data-calendar-agenda]')?.textContent).toContain('No events.');
    cleanup();
    setup({ mode: 'week' });
    expect(document.querySelector('[data-calendar-agenda]')).toBeNull();
  });
});
