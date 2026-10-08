/**
 * @vitest-environment happy-dom
 *
 * The Calendar layout (#2702): the month grid's rows and week start, single-
 * and multi-day placement with continuation, a datetime's local time, an end
 * coarser than the start hatched, the month and year bands with since/until,
 * the Undated tray, "+N more" and the day's list, every keyboard binding on a
 * single roving tab stop, ISO week numbers, paging written back through
 * `onStateChange`, the hover preview, and the read-only embed.
 *
 * happy-dom has no layout, so a cell's capacity is the unmeasured fallback,
 * 4 lines: 3 events and "+N more" on a full day.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import TypeViewCalendar from '../../../src/renderer/lib/components/TypeViewCalendar.svelte';
import { civilMs } from '../../../src/shared/objects/date-precision';
import type { TypeInstanceRow } from '../../../src/shared/objects/type-def';

const settings = vi.hoisted(() => ({ weekStart: 1, showWeekNumbers: false }));
vi.mock('../../../src/renderer/lib/stores/settings-calendar.svelte', () => ({
  getCalendarSettings: () => ({
    get weekStart() { return settings.weekStart; },
    get showWeekNumbers() { return settings.showWeekNumbers; },
  }),
}));

const EVENT = {
  id: 'event', label: 'Event', classLocalName: 'Event', icon: '📅', source: 'stock' as const,
  properties: [
    { name: 'date', type: 'datetime' as const },
    { name: 'end', type: 'datetime' as const },
    { name: 'location', type: 'text' as const, label: 'Location' },
  ],
};
const row = (path: string, title: string, date: string | null, end: string | null = null, location: string | null = null): TypeInstanceRow =>
  ({ path, title, values: { date, end, location }, cover: null });

// October 2026 starts on a Thursday. With a Monday week start its rows are
// 28 Sep–4 Oct, 5–11, 12–18, 19–25 and 26 Oct–1 Nov.
const EVENTS = [
  row('dentist.md', 'Dentist', '2026-10-06', null, 'High Street'),
  row('standup.md', 'Standup', '2026-10-07T09:00:00'),
  row('trip.md', 'Trip', '2026-10-09', '2026-10-14'),
  row('launch.md', 'Launch', '2026-10-20', '2026-11'),
  row('harvest.md', 'Harvest', '2026-09', '2026-11'),
  row('octfest.md', 'Octfest', '2026-10'),
  row('decade.md', 'Big project', '2025', '2027'),
  row('year.md', 'The year', '2026'),
  row('someday.md', 'Someday', null),
  row('bad.md', 'Bad date', '2026-02-30'),
];
const BUSY = ['a', 'b', 'c', 'd', 'e', 'f'].map((k, i) => row(`busy-${k}.md`, `Busy ${k.toUpperCase()}`, `2026-10-15T0${i + 1}:00:00`));

const day = (y: number, m: number, d: number) => civilMs(y, m - 1, d);

function setup(over: Record<string, unknown> = {}) {
  const onStateChange = vi.fn();
  const onOpenNote = vi.fn();
  const utils = render(TypeViewCalendar, {
    type: EVENT,
    properties: EVENT.properties,
    instances: EVENTS,
    month: '2026-10',
    display: (_p: unknown, v: string | null) => v ?? '',
    rowType: () => EVENT,
    onOpenNote,
    onStateChange,
    locale: 'en-GB',
    weekStart: 1,
    ...over,
  });
  const q = (sel: string) => utils.container.querySelector<HTMLElement>(sel);
  const cell = (ms: number) => q(`[role="gridcell"][data-day="${ms}"]`)!;
  const segs = (path: string) => [...utils.container.querySelectorAll<HTMLElement>(`[data-calendar-event][data-note-path="${path}"]`)];
  const grid = () => q('[role="grid"]')!;
  const tabStop = () => utils.container.querySelectorAll<HTMLElement>('[role="gridcell"][tabindex="0"]');
  return { ...utils, onStateChange, onOpenNote, q, cell, segs, grid, tabStop };
}

beforeEach(() => { settings.weekStart = 1; settings.showWeekNumbers = false; });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('the month grid', () => {
  it('is a labelled grid with the weekday headers and the month\'s rows', () => {
    const { grid, q, container } = setup();
    expect(grid().getAttribute('aria-labelledby')).toBe(q('.cal-title')!.id);
    expect(q('.cal-title')!.textContent).toBe('October 2026');
    const heads = [...container.querySelectorAll('[role="columnheader"]')].map((h) => h.getAttribute('aria-label'));
    expect(heads).toEqual(['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']);
    expect(container.querySelectorAll('.cal-week[role="row"]')).toHaveLength(5);
    expect(container.querySelectorAll('[role="gridcell"]')).toHaveLength(35);
  });

  it('shows 4 to 6 rows: February 2026 is 4 with a Sunday start, August 2026 is 6', () => {
    expect(setup({ month: '2026-02', weekStart: 7 }).container.querySelectorAll('.cal-week')).toHaveLength(4);
    cleanup();
    expect(setup({ month: '2026-08', weekStart: 1 }).container.querySelectorAll('.cal-week')).toHaveLength(6);
  });

  it('dims the days of the neighbouring months', () => {
    const { cell } = setup();
    expect(cell(day(2026, 9, 28)).classList.contains('cal-out')).toBe(true);
    expect(cell(day(2026, 10, 1)).classList.contains('cal-out')).toBe(false);
    expect(cell(day(2026, 11, 1)).classList.contains('cal-out')).toBe(true);
  });

  it('names each day with its event count', () => {
    const { cell } = setup();
    expect(cell(day(2026, 10, 6)).getAttribute('aria-label')).toBe('Tuesday, 6 October 2026, 1 event');
    expect(cell(day(2026, 10, 12)).getAttribute('aria-label')).toBe('Monday, 12 October 2026, 1 event');
    expect(cell(day(2026, 10, 2)).getAttribute('aria-label')).toBe('Friday, 2 October 2026, no events');
  });

  it('marks today with aria-current and a ring, and makes it the tab stop', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0));
    const { cell, tabStop } = setup({ month: null });
    const today = cell(day(2026, 10, 7));
    expect(today.getAttribute('aria-current')).toBe('date');
    expect(today.classList.contains('cal-today')).toBe(true);
    expect(tabStop()).toHaveLength(1);
    expect(tabStop()[0]).toBe(today);
  });

  it('a month with no `month` is the current one', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2027, 2, 3, 12, 0));
    const { q } = setup({ month: null });
    expect(q('.cal-title')!.textContent).toBe('March 2027');
  });
});

describe('week start (the setting)', () => {
  const firstColumn = (c: HTMLElement) => c.querySelector('[role="columnheader"]')!.getAttribute('aria-label');

  it('Monday, Sunday or Saturday first, from the per-machine setting', () => {
    settings.weekStart = 1;
    let r = setup({ weekStart: undefined });
    expect(firstColumn(r.container)).toBe('Monday');
    expect(r.q('[role="gridcell"]')!.dataset['day']).toBe(String(day(2026, 9, 28)));
    cleanup();
    settings.weekStart = 7;
    r = setup({ weekStart: undefined });
    expect(firstColumn(r.container)).toBe('Sunday');
    expect(r.q('[role="gridcell"]')!.dataset['day']).toBe(String(day(2026, 9, 27)));
    cleanup();
    settings.weekStart = 6;
    r = setup({ weekStart: undefined });
    expect(firstColumn(r.container)).toBe('Saturday');
    expect(r.q('[role="gridcell"]')!.dataset['day']).toBe(String(day(2026, 9, 26)));
    expect(r.container.querySelectorAll('.cal-week')).toHaveLength(6); // October 2026 is 6 rows from Saturday
  });

  it('Home and End honour it', async () => {
    const { cell } = setup({ weekStart: 7 });
    cell(day(2026, 10, 7)).focus();
    await fireEvent.keyDown(cell(day(2026, 10, 7)), { key: 'Home' });
    await tick();
    expect(document.activeElement).toBe(cell(day(2026, 10, 4))); // Sunday
    await fireEvent.keyDown(document.activeElement!, { key: 'End' });
    await tick();
    expect(document.activeElement).toBe(cell(day(2026, 10, 10))); // Saturday
  });
});

describe('ISO week numbers', () => {
  it('are off by default', () => {
    const { container } = setup({ weekStart: undefined });
    expect(container.querySelectorAll('[role="rowheader"]')).toHaveLength(0);
  });

  it('label each row with the ISO week of its Thursday when on', () => {
    settings.showWeekNumbers = true;
    const { container } = setup({ weekStart: undefined });
    const wk = [...container.querySelectorAll('[role="rowheader"]')].map((h) => h.textContent);
    expect(wk).toEqual(['40', '41', '42', '43', '44']);
    expect(container.querySelector('[role="rowheader"]')!.getAttribute('aria-label')).toBe('Week 40');
    expect(container.querySelector('[role="columnheader"]')!.getAttribute('aria-label')).toBe('Week number');
  });

  it('with a Sunday start, the ISO week holding most of the row', () => {
    const { container } = setup({ weekStart: 7, showWeekNumbers: true });
    // Row 1 is Sun 27 Sep – Sat 3 Oct: its Thursday, 1 Oct, is in ISO week 40.
    expect(container.querySelector('[role="rowheader"]')!.textContent).toBe('40');
  });
});

describe('events', () => {
  it('a single-day event sits in its cell', () => {
    const { segs, cell } = setup();
    const [s] = segs('dentist.md');
    expect(segs('dentist.md')).toHaveLength(1);
    expect(cell(day(2026, 10, 6)).contains(s!)).toBe(true);
    expect(s!.classList.contains('cal-bar')).toBe(false);
    expect(s!.getAttribute('aria-label')).toBe('Dentist, 6 Oct 2026');
  });

  it('a datetime shows its local time', () => {
    const { segs } = setup();
    const [s] = segs('standup.md');
    expect(s!.querySelector('.cal-time')!.textContent).toBe('9:00');
    expect(segs('dentist.md')[0]!.querySelector('.cal-time')).toBeNull();
  });

  it('an offset time lands on the viewer\'s own day (decision 7)', () => {
    // 23:30 in UTC-05:00 on the 5th is 04:30Z on the 6th — past midnight for any zone east of -04:30.
    const offset = row('late.md', 'Late call', '2026-10-05T23:30:00-05:00');
    const { segs, cell } = setup({ instances: [offset] });
    const shift = -new Date(Date.UTC(2026, 9, 6, 4, 30)).getTimezoneOffset();
    const local = new Date(Date.UTC(2026, 9, 6, 4, 30) + shift * 60_000);
    const expected = day(local.getUTCFullYear(), local.getUTCMonth() + 1, local.getUTCDate());
    expect(cell(expected).contains(segs('late.md')[0]!)).toBe(true);
  });

  it('a multi-day event is a bar cut at each week row, with continuation marks', () => {
    const { segs, cell } = setup();
    const parts = segs('trip.md');
    expect(parts).toHaveLength(2);
    const [a, b] = parts as [HTMLElement, HTMLElement];
    // Fri 9 – Sun 11 in row 1, Mon 12 – Wed 14 in row 2.
    expect(cell(day(2026, 10, 9)).contains(a)).toBe(true);
    expect([a.dataset['row'], a.dataset['startCol'], a.dataset['endCol']]).toEqual(['1', '4', '7']);
    expect(a.style.getPropertyValue('--span')).toBe('3');
    expect(a.classList.contains('cal-cont-after')).toBe(true);
    expect(a.classList.contains('cal-cont-before')).toBe(false);
    expect(cell(day(2026, 10, 12)).contains(b)).toBe(true);
    expect([b.dataset['row'], b.dataset['startCol'], b.dataset['endCol']]).toEqual(['2', '0', '3']);
    expect(b.classList.contains('cal-cont-before')).toBe(true);
    expect(b.classList.contains('cal-cont-after')).toBe(false);
    expect(a.classList.contains('cal-bar') && b.classList.contains('cal-bar')).toBe(true);
  });

  it('a bar holds one slot across its row, under the earlier-starting events', () => {
    const instances = [
      row('long.md', 'Long', '2026-10-05', '2026-10-09'),
      row('mid.md', 'Mid', '2026-10-06'),
      row('later.md', 'Later', '2026-10-07', '2026-10-08'),
    ];
    const { segs } = setup({ instances });
    expect(segs('long.md')[0]!.dataset['slot']).toBe('0');
    expect(segs('mid.md')[0]!.dataset['slot']).toBe('1');
    expect(segs('later.md')[0]!.dataset['slot']).toBe('1'); // Mid is over by the 7th
  });

  it('hatches the days an end coarser than the start only might cover', () => {
    const { segs } = setup();
    const [a, b] = segs('launch.md') as [HTMLElement, HTMLElement];
    // 20 Oct to the end of November: row 3 is certain; row 4 turns approximate on Sunday 1 November.
    expect(a.classList.contains('cal-approx')).toBe(false);
    expect(a.querySelector('.cal-hatch')).toBeNull();
    expect(b.classList.contains('cal-approx')).toBe(true);
    expect(b.querySelector('.cal-hatch')).not.toBeNull();
    expect(b.style.getPropertyValue('--solid')).toBe(`${(6 / 7) * 100}%`);
  });

  it('clicking an event opens its note', async () => {
    const { segs, onOpenNote } = setup();
    await fireEvent.click(segs('dentist.md')[0]!);
    expect(onOpenNote).toHaveBeenCalledWith('dentist.md');
  });

  it('places notes by the view\'s Date by', () => {
    const BOOK = {
      id: 'book', label: 'Book', classLocalName: 'Book', icon: '📚', source: 'stock' as const,
      properties: [{ name: 'published', type: 'date' as const }, { name: 'read', type: 'date' as const }],
    };
    const books = [{ path: 'dune.md', title: 'Dune', values: { published: '1965-08-01', read: '2026-10-03' }, cover: null }];
    const { segs, cell } = setup({ type: BOOK, properties: BOOK.properties, instances: books, dateBy: 'read' });
    expect(cell(day(2026, 10, 3)).contains(segs('dune.md')[0]!)).toBe(true);
  });
});

describe('bands and the Undated tray', () => {
  const band = (c: HTMLElement, id: string) => c.querySelector<HTMLElement>(`[data-band="${id}"]`)!;

  it('a month-only start is in the month band of every page its range meets, marked since/until', () => {
    const { container } = setup();
    const m = band(container, 'month');
    expect(m.querySelector('h3')!.textContent).toBe('October 2026 · no day');
    const harvest = m.querySelector<HTMLElement>('[data-note-path="harvest.md"]')!;
    expect(harvest.querySelector('[data-since]')!.textContent).toBe('since September');
    expect(harvest.querySelector('[data-until]')!.textContent).toBe('until November');
    const octfest = m.querySelector<HTMLElement>('[data-note-path="octfest.md"]')!;
    expect(octfest.querySelector('[data-since]')).toBeNull();
    expect(octfest.querySelector('[data-until]')).toBeNull();
    cleanup();
    const nov = setup({ month: '2026-11' }).container;
    const h = band(nov, 'month').querySelector<HTMLElement>('[data-note-path="harvest.md"]')!;
    expect(h.querySelector('[data-since]')!.textContent).toBe('since September');
    expect(h.querySelector('[data-until]')).toBeNull();
    expect(band(nov, 'month').querySelector('[data-note-path="octfest.md"]')).toBeNull();
  });

  it('a year-only start is in the year band, marked since/until by year', () => {
    const { container } = setup();
    const y = band(container, 'year');
    expect(y.querySelector('h3')!.textContent).toBe('2026 · no month');
    const big = y.querySelector<HTMLElement>('[data-note-path="decade.md"]')!;
    expect(big.querySelector('[data-since]')!.textContent).toBe('since 2025');
    expect(big.querySelector('[data-until]')!.textContent).toBe('until 2027');
    expect(y.querySelector('[data-note-path="year.md"] [data-since]')).toBeNull();
    cleanup();
    const later = setup({ month: '2028-01' }).container;
    expect(later.querySelector('[data-band]')).toBeNull();
  });

  it('a band entry is never in the cells, and opens its note', async () => {
    const { container, segs, onOpenNote } = setup();
    expect(segs('harvest.md')).toHaveLength(0);
    expect(segs('decade.md')).toHaveLength(0);
    await fireEvent.click(band(container, 'year').querySelector('[data-note-path="year.md"]')!);
    expect(onOpenNote).toHaveBeenCalledWith('year.md');
  });

  it('the bands come after the grid in tab order', () => {
    const { container, grid } = setup();
    expect(grid().compareDocumentPosition(container.querySelector('.cal-bands')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('missing and unreadable dates go to the Undated tray, with the reason', async () => {
    const { container, onOpenNote } = setup();
    const tray = container.querySelector<HTMLElement>('.cal-undated')!;
    expect(tray.querySelector('[data-note-path="someday.md"]')!.textContent).toContain('No date');
    expect(tray.querySelector('[data-note-path="bad.md"]')!.textContent).toContain("Couldn't read the date '2026-02-30'");
    await fireEvent.click(tray.querySelector('[data-note-path="someday.md"]')!);
    expect(onOpenNote).toHaveBeenCalledWith('someday.md');
  });
});

describe('overflow: "+N more" and the day\'s list', () => {
  it('a full day shows what fits and "+N more" for the rest', () => {
    const { container, cell } = setup({ instances: BUSY });
    const c = cell(day(2026, 10, 15));
    expect(c.querySelectorAll('[data-calendar-event]')).toHaveLength(3);
    expect(c.querySelector('.cal-more')!.textContent).toBe('+3 more');
    expect(c.getAttribute('aria-label')).toBe('Thursday, 15 October 2026, 6 events');
    expect(container.querySelectorAll('.cal-more')).toHaveLength(1);
  });

  it('never draws a bar in pieces: one crossing a full day is hidden on every day of its row', () => {
    const early = ['x', 'y', 'z'].map((k) => row(`early-${k}.md`, `Early ${k}`, '2026-10-13', '2026-10-14'));
    const conf = row('conf.md', 'Conference', '2026-10-14', '2026-10-16');
    const { segs, cell } = setup({ instances: [...early, conf, ...BUSY] });
    // The three early bars take slots 0–2, so the conference gets slot 3 — the "+N more"
    // line of a 4-line cell — and the 15th overflows: it is hidden on all three of its days.
    expect(segs('conf.md')).toHaveLength(0);
    expect(cell(day(2026, 10, 14)).querySelector('.cal-more')!.textContent).toBe('+1 more');
    expect(cell(day(2026, 10, 15)).querySelector('.cal-more')!.textContent).toBe('+4 more');
    expect(cell(day(2026, 10, 16)).querySelector('.cal-more')!.textContent).toBe('+1 more');
    expect(cell(day(2026, 10, 16)).querySelectorAll('[data-calendar-event]')).toHaveLength(0);
  });

  it('a bar above the "+N more" line shows whole across a full day', () => {
    const conf = row('conf.md', 'Conference', '2026-10-14', '2026-10-16');
    const { segs, cell } = setup({ instances: [conf, ...BUSY] });
    expect(segs('conf.md')).toHaveLength(1);
    expect(segs('conf.md')[0]!.style.getPropertyValue('--span')).toBe('3');
    expect(cell(day(2026, 10, 15)).querySelector('.cal-more')!.textContent).toBe('+4 more');
  });

  it('"+N more" opens the day\'s whole list; Escape closes it and returns focus to the day', async () => {
    const { cell, onOpenNote } = setup({ instances: BUSY });
    const c = cell(day(2026, 10, 15));
    await fireEvent.click(c.querySelector('.cal-more')!);
    const dlg = await screen.findByRole('dialog');
    expect(dlg.getAttribute('aria-label')).toBe('Thursday, 15 October 2026, 6 events');
    const items = [...dlg.querySelectorAll<HTMLElement>('[data-day-event]')];
    expect(items.map((i) => i.dataset['notePath'])).toEqual(BUSY.map((b) => b.path));
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    await fireEvent.keyDown(items[0]!, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(items[1]);
    await fireEvent.keyDown(items[1]!, { key: 'End' });
    expect(document.activeElement).toBe(items[5]);
    await fireEvent.keyDown(items[5]!, { key: 'Home' });
    expect(document.activeElement).toBe(items[0]);
    await fireEvent.keyDown(items[0]!, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(c));
    expect(onOpenNote).not.toHaveBeenCalled();
  });

  it('an event in the list opens its note', async () => {
    const { cell, onOpenNote } = setup({ instances: BUSY });
    await fireEvent.click(cell(day(2026, 10, 15)).querySelector('.cal-more')!);
    const dlg = await screen.findByRole('dialog');
    await fireEvent.click(dlg.querySelector('[data-note-path="busy-e.md"]')!);
    expect(onOpenNote).toHaveBeenCalledWith('busy-e.md');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('a press outside closes it', async () => {
    const { cell } = setup({ instances: BUSY });
    await fireEvent.click(cell(day(2026, 10, 15)).querySelector('.cal-more')!);
    await screen.findByRole('dialog');
    await fireEvent.pointerDown(document.body);
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
});

describe('keyboard (the WAI-ARIA date grid)', () => {
  async function press(key: string, opts: Record<string, unknown> = {}) {
    await fireEvent.keyDown(document.activeElement!, { key, ...opts });
    await tick();
    await tick();
  }

  it('one tab stop: the focused day', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2027, 5, 1, 12, 0));
    const { cell, tabStop } = setup();
    expect(tabStop()).toHaveLength(1);
    expect(tabStop()[0]).toBe(cell(day(2026, 10, 1))); // not this month → the 1st
    cell(day(2026, 10, 1)).focus();
    await press('ArrowRight');
    expect(tabStop()).toHaveLength(1);
    expect(tabStop()[0]).toBe(cell(day(2026, 10, 2)));
  });

  it('←/→ move a day, ↑/↓ a week', async () => {
    const { cell } = setup();
    cell(day(2026, 10, 14)).focus();
    await press('ArrowRight');
    expect(document.activeElement).toBe(cell(day(2026, 10, 15)));
    await press('ArrowLeft');
    await press('ArrowLeft');
    expect(document.activeElement).toBe(cell(day(2026, 10, 13)));
    await press('ArrowDown');
    expect(document.activeElement).toBe(cell(day(2026, 10, 20)));
    await press('ArrowUp');
    await press('ArrowUp');
    expect(document.activeElement).toBe(cell(day(2026, 10, 6)));
  });

  it('moves onto the dimmed days without turning, and turns the page past the grid\'s edge', async () => {
    const { cell, onStateChange, q } = setup();
    cell(day(2026, 10, 1)).focus();
    await press('ArrowLeft');
    await press('ArrowLeft');
    await press('ArrowLeft');
    expect(document.activeElement).toBe(cell(day(2026, 9, 28))); // still on October's page
    expect(onStateChange).not.toHaveBeenCalled();
    await press('ArrowLeft');
    expect(onStateChange).toHaveBeenLastCalledWith({ month: '2026-09' });
    expect(q('.cal-title')!.textContent).toBe('September 2026');
    expect(document.activeElement).toBe(cell(day(2026, 9, 27)));
  });

  it('Page Up/Down move a month, Shift a year, clamped to the month\'s end', async () => {
    const { cell, onStateChange, q } = setup({ month: '2027-01' });
    cell(day(2027, 1, 31)).focus();
    await press('PageDown');
    expect(onStateChange).toHaveBeenLastCalledWith({ month: '2027-02' });
    expect(document.activeElement).toBe(cell(day(2027, 2, 28)));
    await press('PageUp');
    expect(onStateChange).toHaveBeenLastCalledWith({ month: '2027-01' });
    expect(document.activeElement).toBe(cell(day(2027, 1, 28)));
    await press('PageDown', { shiftKey: true });
    expect(onStateChange).toHaveBeenLastCalledWith({ month: '2028-01' });
    expect(q('.cal-title')!.textContent).toBe('January 2028');
    await press('PageUp', { shiftKey: true });
    await press('PageUp', { shiftKey: true });
    expect(onStateChange).toHaveBeenLastCalledWith({ month: '2026-01' });
    expect(document.activeElement).toBe(cell(day(2026, 1, 28)));
  });

  it('Home/End go to the row\'s first and last day', async () => {
    const { cell } = setup();
    cell(day(2026, 10, 15)).focus();
    await press('Home');
    expect(document.activeElement).toBe(cell(day(2026, 10, 12)));
    await press('End');
    expect(document.activeElement).toBe(cell(day(2026, 10, 18)));
  });

  it('Enter opens the day\'s list (the same popover as "+N more"), Escape returns to the day', async () => {
    const { cell } = setup();
    cell(day(2026, 10, 12)).focus();
    await press('Enter');
    const dlg = await screen.findByRole('dialog');
    expect([...dlg.querySelectorAll<HTMLElement>('[data-day-event]')].map((i) => i.dataset['notePath'])).toEqual(['trip.md']);
    await waitFor(() => expect(document.activeElement).toBe(dlg.querySelector('[data-day-event]')));
    await press('Escape');
    await waitFor(() => expect(document.activeElement).toBe(cell(day(2026, 10, 12))));
  });

  it('Enter on an empty day says so', async () => {
    const { cell } = setup();
    cell(day(2026, 10, 2)).focus();
    await press(' ');
    const dlg = await screen.findByRole('dialog');
    expect(dlg.textContent).toContain('No events.');
  });

  it('focusing an event in the list shows the hover preview, with its dates', async () => {
    const { cell } = setup();
    cell(day(2026, 10, 6)).focus();
    await press('Enter');
    const tip = await screen.findByRole('tooltip');
    await waitFor(() => expect(tip.textContent).toContain('6 Oct 2026'));
    expect(tip.textContent).toContain('Dentist');
    expect(tip.textContent).toContain('High Street');
  });
});

describe('paging', () => {
  it('Previous / Next / Today write `month` back', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(2026, 9, 7, 12, 0));
    const { onStateChange, q } = setup({ month: '2026-12' });
    await fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(onStateChange).toHaveBeenLastCalledWith({ month: '2027-01' });
    expect(q('.cal-title')!.textContent).toBe('January 2027');
    await fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Previous month' }));
    expect(onStateChange).toHaveBeenLastCalledWith({ month: '2026-11' });
    await fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    expect(onStateChange).toHaveBeenLastCalledWith({ month: null }); // the current month, nothing serialised
    expect(q('.cal-title')!.textContent).toBe('October 2026');
  });

  it('follows a `month` that arrives as props', async () => {
    const { q, rerender } = setup();
    await rerender({ month: '1969-07' });
    expect(q('.cal-title')!.textContent).toBe('July 1969');
  });

  it('pages BCE months', () => {
    const { q } = setup({ month: '-0043-03' });
    expect(q('.cal-title')!.textContent).toBe('March 44 BC');
  });
});

describe('read-only (an embed)', () => {
  it('pages, but writes nothing back', async () => {
    const { onStateChange, q, cell } = setup({ readOnly: true });
    await fireEvent.click(screen.getByRole('button', { name: 'Next month' }));
    expect(q('.cal-title')!.textContent).toBe('November 2026');
    cell(day(2026, 11, 2)).focus();
    await fireEvent.keyDown(document.activeElement!, { key: 'PageDown' });
    await tick();
    expect(q('.cal-title')!.textContent).toBe('December 2026');
    expect(onStateChange).not.toHaveBeenCalled();
  });
});

describe('export mode (the #2704 hook)', () => {
  it('mounts with no toolbar buttons, tab stops or hover, listing every event in its cell', () => {
    const { container, cell } = setup({ instances: BUSY, exportMode: true });
    expect(screen.queryByRole('button', { name: 'Next month' })).toBeNull();
    expect(container.querySelectorAll('[role="gridcell"][tabindex]')).toHaveLength(0);
    expect(cell(day(2026, 10, 15)).querySelectorAll('[data-calendar-event]')).toHaveLength(6);
    expect(container.querySelector('.cal-more')).toBeNull();
  });
});

describe('the hover preview on pointer', () => {
  it('hovering an event shows its dates, and what was written when the day differs', async () => {
    const offset = row('late.md', 'Late call', '2026-10-05T23:30:00-05:00');
    const { segs } = setup({ instances: [offset] });
    await fireEvent.pointerEnter(segs('late.md')[0]!);
    const tip = await screen.findByRole('tooltip');
    await waitFor(() => expect(tip.textContent).toContain('Late call'));
    const shift = -new Date(Date.UTC(2026, 9, 6, 4, 30)).getTimezoneOffset();
    const localDay = new Date(Date.UTC(2026, 9, 6, 4, 30) + shift * 60_000).getUTCDate();
    if (localDay !== 5) expect(tip.querySelector('[data-written-as]')!.textContent).toBe('Written as 2026-10-05T23:30:00-05:00');
    else expect(tip.querySelector('[data-written-as]')).toBeNull();
  });
});
