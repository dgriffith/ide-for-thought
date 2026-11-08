/**
 * @vitest-environment happy-dom
 *
 * The Calendar's Week view (#2951, epic #2949): the Month | Week switch and
 * the page it writes, stepping, the title, events in their column and slot,
 * overlaps side by side, the all-day strip and "+N more", scroll to the
 * first event, the now-line, a DST day, the keyboard (one tab stop, Tab into
 * a cell's events, Enter for the day's list), the note menu and *Move to
 * date…* on a week's days, and the read-only embed.
 *
 * happy-dom has no layout: positions are read off inline styles and data
 * attributes, and `scrollTop` is what the view set.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { fireEvent, cleanup, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { renderCalendar, type CalendarProps } from './fixtures';
import { civilMs } from '../../../src/shared/objects/date-precision';
import type { TypeInstanceRow } from '../../../src/shared/objects/type-def';

const EVENT = {
  id: 'event', label: 'Event', icon: '📅', color: '#89b4fa',
  properties: [{ name: 'date', type: 'datetime' }, { name: 'end', type: 'datetime' }],
};
const row = (path: string, title: string, date: string | null, end: string | null = null): TypeInstanceRow =>
  ({ path, title, values: { date, end }, cover: null });

// Monday 5 – Sunday 11 October 2026 (a Monday week start); "today" is Wednesday the 7th.
const EVENTS = [
  row('holiday.md', 'Holiday', '2026-10-05', '2026-10-06'),
  row('standup.md', 'Standup', '2026-10-06T09:30', '2026-10-06T09:45'),
  row('review.md', 'Design review', '2026-10-07T09:00', '2026-10-07T11:00'),
  row('oneone.md', '1:1 with Ann', '2026-10-07T09:30', '2026-10-07T10:30'),
  row('call.md', 'Call', '2026-10-08T11:00'),
  row('conf.md', 'Conference', '2026-10-08T09:00', '2026-10-10T17:00'),
  row('night.md', 'Night shift', '2026-10-09T22:00', '2026-10-10T02:00'),
  row('octfest.md', 'Octfest', '2026-10'),
  row('next.md', 'Next week', '2026-10-13T10:00'),
  row('someday.md', 'Someday', null),
];
const day = (y: number, m: number, d: number) => civilMs(y, m - 1, d);
const TODAY = day(2026, 10, 7);

function setup(over: Partial<CalendarProps> = {}) {
  const utils = renderCalendar({
    type: EVENT, properties: EVENT.properties, instances: EVENTS, mode: 'week', date: '2026-10-07', locale: 'en-GB', weekStart: 1, ...over,
  });
  const q = (sel: string) => utils.container.querySelector<HTMLElement>(sel);
  const qa = (sel: string) => [...utils.container.querySelectorAll<HTMLElement>(sel)];
  const cell = (d: number, slot: number) => q(`[role="gridcell"][data-day="${d}"][data-slot="${slot}"]`)!;
  const ev = (path: string) => qa(`[data-calendar-event][data-note-path="${path}"]`);
  const title = () => q('.cal-title')!.textContent.replace(/\s+/g, ' '); // the locale's range format uses thin spaces
  const tabStop = () => qa('[role="gridcell"][tabindex="0"]');
  return { ...utils, q, qa, cell, ev, title, tabStop };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 9, 7, 10, 15));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the Month | Week switch (#2951)', () => {
  it('a month page following today opens today\'s week with `date` unwritten, and back again', async () => {
    const s = setup({ mode: null, date: null, month: null });
    expect(s.q('[role="grid"][data-month]')).not.toBeNull();
    await fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(s.onStateChange).toHaveBeenLastCalledWith({ mode: 'week', date: null });
    expect(s.title()).toBe('5 – 11 October 2026');
    expect(screen.getByRole('button', { name: 'Week' }).getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(s.onStateChange).toHaveBeenLastCalledWith({ mode: null, month: null });
    expect(s.title()).toBe('October 2026');
  });

  it('an explicit month opens the week of its 1st (today isn\'t in it), written out', async () => {
    const s = setup({ mode: null, date: null, month: '2026-12' });
    await fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(s.onStateChange).toHaveBeenLastCalledWith({ mode: 'week', date: '2026-12-01' });
    expect(s.title()).toBe('30 November – 6 December 2026');
  });

  it('opens the week of the focused day when the month grid has one', async () => {
    const s = setup({ mode: null, date: null, month: '2026-10' });
    s.q(`[role="gridcell"][data-day="${day(2026, 10, 20)}"]`)!.focus();
    await fireEvent.click(screen.getByRole('button', { name: 'Week' }));
    expect(s.onStateChange).toHaveBeenLastCalledWith({ mode: 'week', date: '2026-10-20' });
  });

  it('a week written out goes back to its month, written out', async () => {
    const s = setup({ date: '2026-12-30' });
    expect(s.title()).toBe('28 December 2026 – 3 January 2027');
    await fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(s.onStateChange).toHaveBeenLastCalledWith({ mode: null, month: '2026-12' });
  });
});

describe('paging a week (#2951)', () => {
  it('‹ and › step a week and write `date`; Today writes it unset', async () => {
    const s = setup();
    await fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(s.onStateChange).toHaveBeenLastCalledWith({ date: '2026-10-14' });
    expect(s.title()).toBe('12 – 18 October 2026');
    expect(s.ev('next.md')).toHaveLength(1);
    await fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Previous week' }));
    expect(s.title()).toBe('28 September – 4 October 2026');
    await fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(s.onStateChange).toHaveBeenLastCalledWith({ date: null });
    expect(s.title()).toBe('5 – 11 October 2026');
  });

  it('starts on the viewer\'s week start, and says the ISO week number when that setting is on', () => {
    const s = setup({ weekStart: 7, showWeekNumbers: true });
    expect(s.title()).toBe('Week 41 · 4 – 10 October 2026');
    expect(s.qa('[role="columnheader"]').slice(1).map((h) => h.getAttribute('aria-label'))[0]).toBe('Sunday, 4 October 2026');
  });

  it('read-only (an embed) pages and switches on screen, and writes nothing', async () => {
    const s = setup({ readOnly: true, date: '2026-12-02' });
    await fireEvent.click(screen.getByRole('button', { name: 'Next week' }));
    expect(s.title()).toBe('7 – 13 December 2026');
    await fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(s.title()).toBe('5 – 11 October 2026');
    await fireEvent.click(screen.getByRole('button', { name: 'Month' }));
    expect(s.title()).toBe('October 2026');
    expect(s.onStateChange).not.toHaveBeenCalled();
  });
});

describe('the week\'s events (#2951)', () => {
  it('puts timed events in their day and slot, sized by duration', () => {
    const s = setup();
    const standup = s.ev('standup.md')[0]!;
    expect(standup.closest('[role="gridcell"]')!.dataset['day']).toBe(String(day(2026, 10, 6)));
    expect(standup.closest('[role="gridcell"]')!.dataset['slot']).toBe('19'); // 9:30
    expect(standup.style.top).toBe('0px');
    expect(standup.style.height).toBe('15px'); // 15 minutes is under the 16px floor, less the 1px gap
    expect(standup.textContent).toContain('9:30');
  });

  it('overlapping events share the column side by side', () => {
    const s = setup();
    const review = s.ev('review.md')[0]!;
    const oneone = s.ev('oneone.md')[0]!;
    expect([review.dataset['lane'], review.dataset['lanes']]).toEqual(['0', '2']);
    expect([oneone.dataset['lane'], oneone.dataset['lanes']]).toEqual(['1', '2']);
    expect(oneone.style.left).toBe('calc(50% + 1px)');
    expect(review.style.height).toBe('95px'); // two hours at 48px
    expect(review.textContent).toContain('09:00–11:00'); // the locale's own range format
  });

  it('an event with no end is drawn half an hour long and hatched', () => {
    const call = setup().ev('call.md')[0]!;
    expect(call.classList.contains('wk-approx')).toBe(true);
    expect(call.dataset['endMin']).toBe(String(11 * 60 + 30));
  });

  it('cuts an event at midnight, and puts a 24h+ one in the strip', () => {
    const s = setup();
    const night = s.ev('night.md').sort((a, b) => Number(a.dataset['col']) - Number(b.dataset['col']));
    expect(night.map((e) => [e.dataset['col'], e.dataset['startMin'], e.dataset['endMin']])).toEqual([['4', '1320', '1440'], ['5', '0', '120']]);
    expect(night[1]!.textContent).toContain('‹');
    const conf = s.ev('conf.md');
    expect(conf).toHaveLength(1);
    expect(conf[0]!.classList.contains('wk-bar')).toBe(true);
    expect(conf[0]!.closest('[role="gridcell"]')!.dataset['slot']).toBe('-1');
    expect(conf[0]!.style.getPropertyValue('--span')).toBe('3');
  });

  it('draws each event in its type\'s colour: a subtype\'s own, else the view\'s', () => {
    const s = setup({ colors: { 'call.md': '#a6e3a1' } });
    expect(s.ev('call.md')[0]!.style.getPropertyValue('--ev-color')).toBe('#a6e3a1');
    expect(s.ev('standup.md')[0]!.style.getPropertyValue('--ev-color')).toBe('#89b4fa');
  });

  it('names an event by what it shows and describes it with its day and times', () => {
    const s = setup();
    const review = s.ev('review.md')[0]!;
    const desc = review.getAttribute('aria-describedby')!.split(' ').map((id) => s.container.querySelector(`[id="${id}"]`)!.textContent).join(' ');
    expect(desc).toBe('Design review, Wednesday, 7 October 2026, 09:00–11:00');
    const night = s.ev('night.md')[0]!;
    expect(s.container.querySelector(`[id="${night.getAttribute('aria-describedby')}"]`)!.textContent)
      .toBe('Night shift, Friday, 9 October 2026, 22:00 – Saturday, 10 October 2026, 2:00');
  });

  it('keeps the bands and the Undated tray, for the week', () => {
    const s = setup();
    expect(s.q('[data-band="month"]')?.textContent ?? s.container.textContent).toContain('Octfest');
    expect(s.container.textContent).toContain('Undated');
    expect(s.container.textContent).toContain('Someday');
  });

  it('opens a clicked event', async () => {
    const s = setup();
    await fireEvent.click(s.ev('review.md')[0]!);
    expect(s.onOpenNote).toHaveBeenCalledWith('review.md');
  });
});

describe('the all-day strip (#2951)', () => {
  const many = ['a', 'b', 'c', 'd'].map((k) => row(`ad-${k}.md`, `All day ${k}`, '2026-10-06'));

  it('shows up to three lines, then "+N more", which opens the day\'s list', async () => {
    const s = setup({ instances: many });
    const shown = s.qa('.wk-bar').map((b) => b.dataset['notePath']);
    expect(shown).toHaveLength(2);
    const more = screen.getByRole('button', { name: '2 more on Tuesday, 6 October 2026' });
    await fireEvent.click(more);
    await waitFor(() => expect(screen.getByRole('dialog', { name: 'Tuesday, 6 October 2026, 4 events' })).toBeTruthy());
    expect(screen.getByRole('dialog').querySelectorAll('[data-day-event]')).toHaveLength(4);
  });

  it('shows three when three fit', () => {
    expect(setup({ instances: many.slice(0, 3) }).qa('.wk-bar')).toHaveLength(3);
  });
});

describe('scroll, now and DST (#2951)', () => {
  it('opens scrolled half an hour before the week\'s first timed event, else at 8:00', async () => {
    const s = setup();
    await tick();
    expect(s.q('.wk-hours')!.scrollTop).toBe(8.5 * 48); // the earliest start is Wednesday's 9:00
    cleanup();
    const empty = setup({ instances: [row('a.md', 'All day', '2026-10-06')] });
    await tick();
    expect(empty.q('.wk-hours')!.scrollTop).toBe(8 * 48);
  });

  it('draws a now-line on today\'s column only', () => {
    const s = setup();
    const line = s.q('.wk-now')!;
    expect(line.closest('[role="gridcell"]')!.dataset['day']).toBe(String(TODAY));
    expect(line.closest('[role="gridcell"]')!.dataset['slot']).toBe('20'); // 10:15
    expect(line.style.top).toBe('12px');
    cleanup();
    expect(setup({ date: '2026-10-14' }).q('.wk-now')).toBeNull();
  });

  it('a day whose clocks change says so, and marks the hour', () => {
    const tz = process.env['TZ'];
    process.env['TZ'] = 'America/New_York';
    try {
      const s = setup({ date: '2026-11-01', weekStart: 7 }); // Sunday 1 November: clocks go back
      const head = s.qa('[role="columnheader"]').find((h) => h.getAttribute('aria-label')!.startsWith('Sunday, 1 November'))!;
      expect(head.getAttribute('aria-label')).toBe('Sunday, 1 November 2026. Clocks go back: 1:00 – 2:00 happens twice');
      expect(head.textContent).toContain('Clocks back');
      const mark = s.q('.wk-dst-line')!;
      expect(mark.closest('[role="gridcell"]')!.dataset['slot']).toBe('2');
      expect(mark.style.height).toBe('48px');
    } finally {
      process.env['TZ'] = tz;
    }
  });
});

describe('keyboard (#2951)', () => {
  it('one tab stop, on today at the first event\'s slot; arrows move by day and half hour', async () => {
    const s = setup();
    expect(s.tabStop()).toEqual([s.cell(TODAY, 18)]); // today, at the week's earliest start (9:00)
    s.cell(TODAY, 18).focus();
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(s.cell(TODAY, 19));
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(s.cell(day(2026, 10, 6), 19));
    expect(s.tabStop()).toEqual([s.cell(day(2026, 10, 6), 19)]);
  });

  it('↑ from midnight reaches the all-day cell; ↓ stops at 23:30', async () => {
    const s = setup();
    s.cell(TODAY, 0).focus();
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowUp' });
    expect(document.activeElement).toBe(s.cell(TODAY, -1));
    s.cell(TODAY, 47).focus();
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(s.cell(TODAY, 47));
  });

  it('turns the page past the week\'s edge and with Page Up/Down, writing `date`', async () => {
    const s = setup();
    s.cell(day(2026, 10, 11), 20).focus();
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement).toBe(s.cell(day(2026, 10, 12), 20)));
    expect(s.onStateChange).toHaveBeenLastCalledWith({ date: '2026-10-12' });
    await fireEvent.keyDown(document.activeElement!, { key: 'PageUp' });
    await waitFor(() => expect(document.activeElement).toBe(s.cell(day(2026, 10, 5), 20)));
    await fireEvent.keyDown(document.activeElement!, { key: 'End' });
    expect(document.activeElement).toBe(s.cell(day(2026, 10, 11), 20));
  });

  it('Tab goes into the cell\'s events in time order, Shift+Tab and Escape come back', async () => {
    const s = setup();
    const c = s.cell(TODAY, 18);
    c.focus();
    await fireEvent.keyDown(c, { key: 'Tab' });
    expect(document.activeElement).toBe(s.ev('review.md')[0]);
    await fireEvent.keyDown(document.activeElement!, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(c);
    const c2 = s.cell(TODAY, 19);
    c2.focus();
    await fireEvent.keyDown(c2, { key: 'Tab' });
    expect(document.activeElement).toBe(s.ev('oneone.md')[0]);
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    expect(document.activeElement).toBe(c2);
  });

  it('Enter on a cell opens that day\'s list, and Escape returns to the cell', async () => {
    const s = setup();
    const c = s.cell(TODAY, 18);
    c.focus();
    await fireEvent.keyDown(c, { key: 'Enter' });
    const dialog = await screen.findByRole('dialog', { name: 'Wednesday, 7 October 2026, 2 events' });
    expect([...dialog.querySelectorAll('[data-day-event]')].map((e) => e.textContent)).toEqual([
      expect.stringContaining('Design review'), expect.stringContaining('1:1 with Ann'),
    ]);
    await fireEvent.keyDown(document.activeElement!, { key: 'Escape' });
    await waitFor(() => expect(document.activeElement).toBe(c));
  });

  it('a refresh (a new view, same page) leaves a day\'s list open, in Month and in Week', async () => {
    // Every write re-projects the view: new objects, same week. Only a page turn closes the list.
    for (const mode of ['week', null] as const) {
      const s = setup({ mode });
      const c = mode ? s.cell(TODAY, 18) : s.q(`[role="gridcell"][data-day="${TODAY}"]`)!;
      c.focus();
      await fireEvent.keyDown(c, { key: 'Enter' });
      await screen.findByRole('dialog');
      await s.rerender({ instances: [...EVENTS, row('new.md', 'Unrelated', null)] });
      await tick();
      expect(screen.queryByRole('dialog')).not.toBeNull();
      cleanup();
    }
  });

  it('Shift+F10 on an event asks for Minerva\'s note menu', async () => {
    const s = setup({ rowMenu: true });
    const review = s.ev('review.md')[0]!;
    review.focus();
    await fireEvent.keyDown(review, { key: 'F10', shiftKey: true });
    expect(s.api.calls.find((c) => c.method === 'ui.showNoteMenu')?.params).toMatchObject({ paths: ['review.md'] });
  });
});

describe('Move to date… on a week (#2951)', () => {
  it('chooses one of the week\'s days and asks Minerva to move the note there', async () => {
    const s = setup({ rowMenu: true });
    s.api.emit('moveToDate', { path: 'review.md' });
    await waitFor(() => expect(document.activeElement?.dataset['day']).toBe(String(TODAY)));
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    await fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(s.api.calls.find((c) => c.method === 'view.reschedule')?.params).toEqual({ path: 'review.md', days: 1 });
  });
});
