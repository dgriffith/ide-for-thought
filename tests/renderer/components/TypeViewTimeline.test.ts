/**
 * @vitest-environment happy-dom
 *
 * The Timeline layout (#2608): points and bars, partial dates drawn as
 * hatched spans, lanes for overlaps, the Undated tray, every keyboard binding
 * on a single roving tab stop, zoom/pan/Fit writing `from`/`to` back (Fit
 * bounded by a range filter), a backwards `end` flagged on the hover card,
 * the list alternative, the read-only embed, and export mode (#2609).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, within, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import TypeViewTimeline from '../../../src/renderer/lib/components/TypeViewTimeline.svelte';
import { civilMs } from '../../../src/shared/objects/date-precision';
import { timelineDomain } from '../../../src/shared/objects/timeline';
import type { TypeInstanceRow } from '../../../src/shared/objects/type-def';
import { silenceLogTags } from '../../helpers/quiet-logs';

const exportFails = vi.hoisted(() => ({ on: false }));
// Lets one test make the export drawing throw, to see the fallback list.
vi.mock('../../../src/renderer/lib/components/timeline/timeline-export', async (orig) => {
  const real = await orig<typeof import('../../../src/renderer/lib/components/timeline/timeline-export')>();
  return {
    ...real,
    planTimelineExport: (...args: Parameters<typeof real.planTimelineExport>) => {
      if (exportFails.on) throw new Error('layout exploded');
      return real.planTimelineExport(...args);
    },
  };
});
silenceLogTags('objects');

const EVENT = {
  id: 'event', label: 'Event', classLocalName: 'Event', icon: '📅', source: 'stock' as const,
  properties: [
    // Stock Event's dates are `datetime` since #2613.
    { name: 'date', type: 'datetime' as const },
    { name: 'end', type: 'datetime' as const },
    { name: 'location', type: 'text' as const, label: 'Location' },
  ],
};
const row = (path: string, title: string, date: string | null, end: string | null = null, location: string | null = null): TypeInstanceRow =>
  ({ path, title, values: { date, end, location }, cover: null });

const EVENTS = [
  row('moon.md', 'Moon landing', '1969-07-20', null, 'Sea of Tranquility'),
  row('apollo.md', 'Apollo 11', '1969-07-16', '1969-07-24'),
  row('woodstock.md', 'Woodstock', '1969-08'),
  row('decade.md', 'The sixties', '1960', '1969'),
  row('typo.md', 'Typo', '1972-05-01', '1971-01-01'),
  row('someday.md', 'Someday', null),
  row('bad.md', 'Bad date', '1969-02-30'),
];

function setup(over: Record<string, unknown> = {}) {
  const onStateChange = vi.fn();
  const onOpenNote = vi.fn();
  const utils = render(TypeViewTimeline, {
    type: EVENT,
    properties: EVENT.properties,
    instances: EVENTS,
    filters: [],
    from: null,
    to: null,
    display: (_p: unknown, v: string | null) => v ?? '',
    rowType: () => EVENT,
    onOpenNote,
    onStateChange,
    locale: 'en-GB',
    ...over,
  });
  const event = (path: string) => utils.container.querySelector<SVGGElement>(`[data-timeline-event][data-note-path="${path}"]`)!;
  const plot = () => utils.container.querySelector<SVGSVGElement>('.tl-plot')!;
  const domain = () => ({ start: Number(plot().dataset['domainStart']), end: Number(plot().dataset['domainEnd']) });
  return { ...utils, onStateChange, onOpenNote, event, plot, domain };
}

afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('drawing', () => {
  it('draws an event with an end as a bar and one without as a point, at a zoom where a day is narrow', () => {
    const { event } = setup();
    expect(event('moon.md').dataset['kind']).toBe('point'); // a day across ~12 years
    expect(event('decade.md').dataset['kind']).toBe('bar');
    expect(event('apollo.md').dataset['kind']).toBe('point'); // nine days is narrower than the marker here
  });

  it('a day is a bar once zoomed in far enough', () => {
    const { event } = setup({ from: '1969-07-01', to: '1969-07-31' });
    expect(event('apollo.md').dataset['kind']).toBe('bar');
    expect(event('moon.md').dataset['kind']).toBe('bar');
  });

  it('names each event for a screen reader, with its dates', () => {
    const { event } = setup();
    expect(event('moon.md').getAttribute('role')).toBe('link');
    expect(event('moon.md').getAttribute('aria-label')).toBe('Moon landing, 20 Jul 1969');
    expect(event('apollo.md').getAttribute('aria-label')!.replace(/\s/g, ' ')).toBe('Apollo 11, 16 Jul 1969 – 24 Jul 1969');
  });

  it('draws a partial date as its precision span, hatched with a dashed outline', () => {
    const { event, container } = setup({ from: '1969', to: '1969' });
    const w = event('woodstock.md');
    expect(w.classList.contains('approx')).toBe(true);
    const hatched = w.querySelector('rect.tl-bar-approx')!;
    const pattern = container.querySelector('pattern')!;
    expect(hatched.getAttribute('fill')).toBe(`url(#${pattern.id})`);
    expect(event('moon.md').classList.contains('approx')).toBe(false);
    // 1960–1969: hatched first and last year, solid between.
    const { event: e2 } = setup({ from: '1955', to: '1975' });
    const decade = e2('decade.md');
    expect(decade.querySelectorAll('rect.tl-bar-approx')).toHaveLength(2);
    expect(decade.querySelectorAll('rect.tl-bar:not(.tl-bar-approx)')).toHaveLength(1);
  });

  it('gives overlapping events separate lanes', () => {
    const { event } = setup({ from: '1969-07-01', to: '1969-08-31', instances: EVENTS.slice(0, 3) });
    // Apollo 11 (16–24 July) and the Moon landing (20 July) overlap; Woodstock (August) is clear of both.
    expect(event('moon.md').dataset['lane']).not.toBe(event('apollo.md').dataset['lane']);
    expect(event('woodstock.md').dataset['lane']).toBe('0');
  });

  it('pattern ids are per instance', () => {
    const a = setup();
    const b = setup();
    const ids = [...a.container.querySelectorAll('pattern'), ...b.container.querySelectorAll('pattern')].map((p) => p.id);
    expect(new Set(ids).size).toBe(2);
  });
});

describe('datetime values (#2613)', () => {
  // Two meetings on one day, as the graph reads `datetime` values back (with seconds).
  const DAY = [
    row('standup.md', 'Standup', '2026-10-05T09:00:00', '2026-10-05T09:15:00'),
    row('review.md', 'Review', '2026-10-05T14:30:00', '2026-10-05T16:00:00'),
  ];

  it('orders two events on the same day by their times, and steps through them that way', async () => {
    const { event } = setup({ instances: [...DAY].reverse() });
    expect(event('standup.md').getAttribute('tabindex')).toBe('0');
    event('standup.md').focus();
    await fireEvent.keyDown(event('standup.md'), { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement).toBe(event('review.md')));
  });

  it('zoomed into the day, each is a bar at its own hours, and a zoom writes minute-precision from/to', async () => {
    vi.useFakeTimers();
    const { event, domain, onStateChange } = setup({ instances: DAY, from: '2026-10-05T08:00', to: '2026-10-05T18:00' });
    expect(domain()).toEqual({ start: civilMs(2026, 9, 5, 8), end: civilMs(2026, 9, 5, 18) });
    expect(event('standup.md').dataset['kind']).toBe('bar');
    expect(event('review.md').dataset['kind']).toBe('bar');
    const x = (p: string) => Number(event(p).querySelector('rect.tl-bar')!.getAttribute('x'));
    expect(x('review.md')).toBeGreaterThan(x('standup.md'));
    await fireEvent.keyDown(event('standup.md'), { key: '+' });
    vi.advanceTimersByTime(400);
    const written = onStateChange.mock.calls[0]![0] as { from: string; to: string };
    expect(written.from).toMatch(/^2026-10-05T\d\d:\d\d$/);
    expect(written.to).toMatch(/^2026-10-05T\d\d:\d\d$/);
  });
});

describe('Undated tray', () => {
  it('lists the events with no readable date, with why, and opens one on click', async () => {
    const { container, onOpenNote, event } = setup();
    const tray = within(container.querySelector<HTMLElement>('.tl-undated')!);
    expect(tray.getByRole('heading').textContent).toMatch(/Undated\s*2/);
    expect(tray.getByRole('button', { name: /Someday/ }).textContent).toContain('No date');
    expect(tray.getByRole('button', { name: /Bad date/ }).textContent).toContain("Couldn't read the date '1969-02-30'");
    await fireEvent.click(tray.getByRole('button', { name: /Someday/ }));
    expect(onOpenNote).toHaveBeenCalledWith('someday.md');
    // A backwards end is not undated: it is drawn.
    expect(event('typo.md')).toBeTruthy();
  });
});

describe('opening and the hover card', () => {
  it('clicking an event opens its note', async () => {
    const { event, onOpenNote } = setup();
    await fireEvent.click(event('moon.md'));
    expect(onOpenNote).toHaveBeenCalledWith('moon.md');
  });

  // The hover is the shared NoteHoverPreview (#2710): it opens after the
  // link-hover delay and closes after a short grace, hence the waits.
  it('hovering shows the preview: dates and the type\'s fields', async () => {
    setup();
    const { event } = { event: (p: string) => document.querySelector<SVGGElement>(`[data-note-path="${p}"]`)! };
    await fireEvent.pointerEnter(event('moon.md'));
    const card = await screen.findByRole('tooltip');
    await waitFor(() => expect(card.textContent).toContain('20 Jul 1969'));
    expect(card.textContent).toContain('Moon landing');
    expect(card.textContent).toContain('Sea of Tranquility');
    await fireEvent.pointerLeave(event('moon.md'));
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('flags a backwards end on the card, and keeps the event at its start', async () => {
    const { event } = setup();
    expect(event('typo.md').hasAttribute('data-end-issue')).toBe(true);
    expect(event('typo.md').getAttribute('aria-label')).toBe('Typo, 1 May 1972 (end date ignored)');
    await fireEvent.pointerEnter(event('typo.md'));
    expect((await screen.findByRole('tooltip')).textContent).toContain('End date ignored: 1971-01-01 is before the start');
  });

  it('a partial date says it is approximate on the card', async () => {
    const { event } = setup();
    await fireEvent.pointerEnter(event('woodstock.md'));
    expect((await screen.findByRole('tooltip')).textContent).toContain('approximate');
  });
});

describe('keyboard', () => {
  // Time order: The sixties (1960), Apollo 11 (16 Jul 69), Moon landing (20 Jul), Woodstock (Aug 69), Typo (1972).
  const ORDER = ['decade.md', 'apollo.md', 'moon.md', 'woodstock.md', 'typo.md'];

  it('is one tab stop: the first event', () => {
    const { container, event } = setup();
    expect(container.querySelectorAll('[data-timeline-event][tabindex="0"]')).toHaveLength(1);
    expect(event(ORDER[0]!).getAttribute('tabindex')).toBe('0');
  });

  it('←/→ step through the events in time order, Home/End to the ends, Enter opens', async () => {
    const { event, onOpenNote } = setup();
    event(ORDER[0]!).focus();
    for (const next of ORDER.slice(1)) {
      await fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
      await waitFor(() => expect(document.activeElement).toBe(event(next)));
    }
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' }); // the last: stays
    expect(document.activeElement).toBe(event('typo.md'));
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowLeft' });
    await waitFor(() => expect(document.activeElement).toBe(event('woodstock.md')));
    await fireEvent.keyDown(document.activeElement!, { key: 'Home' });
    await waitFor(() => expect(document.activeElement).toBe(event('decade.md')));
    await fireEvent.keyDown(document.activeElement!, { key: 'End' });
    await waitFor(() => expect(document.activeElement).toBe(event('typo.md')));
    // The tab stop follows focus.
    expect(event('typo.md').getAttribute('tabindex')).toBe('0');
    expect(event('decade.md').getAttribute('tabindex')).toBe('-1');
    await fireEvent.keyDown(document.activeElement!, { key: 'Enter' });
    expect(onOpenNote).toHaveBeenCalledWith('typo.md');
  });

  it('focusing an event by keyboard shows its card', async () => {
    const { event } = setup();
    event('typo.md').focus();
    await tick();
    expect(screen.getByRole('tooltip').textContent).toContain('End date ignored');
    expect(event('typo.md').getAttribute('aria-describedby')).toBe(screen.getByRole('tooltip').id);
  });

  it('stepping to an event out of view pans to it', async () => {
    const { event, domain } = setup({ from: '1960', to: '1960' });
    event('decade.md').focus();
    await fireEvent.keyDown(document.activeElement!, { key: 'End' });
    await waitFor(() => expect(document.activeElement).toBe(event('typo.md')));
    const d = domain();
    expect(d.start).toBeLessThanOrEqual(civilMs(1972, 4, 1));
    expect(d.end).toBeGreaterThan(civilMs(1972, 4, 2));
  });

  it('Shift+←/→ pans without moving focus, and writes the range back once it settles', async () => {
    vi.useFakeTimers();
    const { event, domain, onStateChange } = setup({ from: '1960', to: '1979' });
    event('decade.md').focus();
    const before = domain();
    await fireEvent.keyDown(event('decade.md'), { key: 'ArrowRight', shiftKey: true });
    await fireEvent.keyDown(event('decade.md'), { key: 'ArrowRight', shiftKey: true });
    const after = domain();
    expect(after.start).toBeGreaterThan(before.start);
    expect(after.end - after.start).toBeCloseTo(before.end - before.start, -3);
    expect(document.activeElement).toBe(event('decade.md'));
    expect(onStateChange).not.toHaveBeenCalled(); // not per keystroke
    vi.advanceTimersByTime(400);
    expect(onStateChange).toHaveBeenCalledTimes(1);
    const written = onStateChange.mock.calls[0]![0];
    const back = timelineDomain(written);
    expect(back.start).toBeLessThanOrEqual(after.start);
    expect(back.end).toBeGreaterThanOrEqual(after.end);
  });

  it('+ and − zoom, and the range is written back', async () => {
    vi.useFakeTimers();
    const { event, domain, onStateChange } = setup({ from: '1960', to: '1979' });
    event('moon.md').focus();
    const before = domain();
    await fireEvent.keyDown(event('moon.md'), { key: '+' });
    const zoomed = domain();
    expect(zoomed.end - zoomed.start).toBeLessThan(before.end - before.start);
    vi.advanceTimersByTime(400);
    expect(onStateChange).toHaveBeenCalledTimes(1);
    await fireEvent.keyDown(event('moon.md'), { key: '-' });
    await fireEvent.keyDown(event('moon.md'), { key: '-' });
    expect(domain().end - domain().start).toBeGreaterThan(before.end - before.start);
    vi.advanceTimersByTime(400);
    expect(onStateChange).toHaveBeenCalledTimes(2);
  });

  it('its own write echoing back as props does not move the view', async () => {
    vi.useFakeTimers();
    const { event, domain, onStateChange, rerender } = setup({ from: '1960', to: '1979' });
    event('moon.md').focus();
    await fireEvent.keyDown(event('moon.md'), { key: '+' });
    const zoomed = domain();
    vi.advanceTimersByTime(400);
    await rerender(onStateChange.mock.calls[0]![0]);
    expect(domain()).toEqual(zoomed);
    // A range from elsewhere (Back, a restored tab) does move it.
    await rerender({ from: '1969', to: '1969' });
    expect(domain()).toEqual({ start: civilMs(1969, 0, 1), end: civilMs(1970, 0, 1) });
  });
});

describe('zoom controls and Fit', () => {
  it('the buttons zoom', async () => {
    const { domain } = setup({ from: '1960', to: '1979' });
    const before = domain();
    await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    expect(domain().end - domain().start).toBeLessThan(before.end - before.start);
    await fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    await fireEvent.click(screen.getByRole('button', { name: 'Zoom out' }));
    expect(domain().end - domain().start).toBeGreaterThan(before.end - before.start);
  });

  it('Fit shows every dated event and writes fit-all', async () => {
    const { domain, onStateChange } = setup({ from: '1969-07-01', to: '1969-07-31' });
    await fireEvent.click(screen.getByRole('button', { name: 'Fit' }));
    expect(onStateChange).toHaveBeenLastCalledWith({ from: null, to: null });
    const d = domain();
    expect(d.start).toBeLessThan(civilMs(1960, 0, 1));
    expect(d.end).toBeGreaterThan(civilMs(1972, 4, 2));
  });

  it('a date range filter bounds Fit', async () => {
    const instances = [row('a.md', 'A', '1965'), row('b.md', 'B', '1968', '1990')];
    const { domain } = setup({ instances, filters: [{ property: 'date', min: '1960', max: '1970' }] });
    expect(domain().end).toBe(civilMs(1971, 0, 1)); // B runs to 1990, but the filter's window ends with 1970
    expect(domain().start).toBeGreaterThanOrEqual(civilMs(1960, 0, 1));
    const open = setup({ instances });
    expect(open.domain().end).toBeGreaterThan(civilMs(1990, 0, 1));
  });

  it('wheel zooms about the pointer and settles into one write', async () => {
    vi.useFakeTimers();
    const { container, domain, onStateChange } = setup({ from: '1960', to: '1979' });
    const viewport = container.querySelector<HTMLElement>('.tl-viewport')!;
    const before = domain();
    await fireEvent.wheel(viewport, { deltaY: -120, clientX: 0 });
    await fireEvent.wheel(viewport, { deltaY: -120, clientX: 0 });
    expect(domain().end - domain().start).toBeLessThan(before.end - before.start);
    expect(onStateChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(onStateChange).toHaveBeenCalledTimes(1);
  });

  it('drag pans, writes once on release, and the release does not open an event', async () => {
    const { container, domain, onStateChange, onOpenNote, event } = setup({ from: '1960', to: '1979' });
    const viewport = container.querySelector<HTMLElement>('.tl-viewport')!;
    const before = domain();
    await fireEvent.pointerDown(event('moon.md'), { button: 0, isPrimary: true, pointerId: 1, clientX: 300, clientY: 50 });
    await fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 250, clientY: 50 });
    await fireEvent.pointerMove(viewport, { pointerId: 1, clientX: 200, clientY: 50 });
    expect(domain().start).toBeGreaterThan(before.start); // dragged left: later
    expect(onStateChange).not.toHaveBeenCalled();
    await fireEvent.pointerUp(viewport, { pointerId: 1, clientX: 200, clientY: 50 });
    await fireEvent.click(event('moon.md'));
    expect(onOpenNote).not.toHaveBeenCalled();
    await waitFor(() => expect(onStateChange).toHaveBeenCalledTimes(1));
  });
});

describe('the list alternative', () => {
  it('List swaps the drawing for the same events in the same order, with the Undated tray', async () => {
    const { container, onOpenNote } = setup();
    const toggle = screen.getByRole('button', { name: 'List' });
    expect(toggle.getAttribute('aria-pressed')).toBe('false');
    await fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.tl-plot')).toBeNull();
    const list = screen.getByRole('list', { name: 'Event in time order' });
    const items = within(list).getAllByRole('button').map((b) => b.dataset['notePath']);
    expect(items).toEqual(['decade.md', 'apollo.md', 'moon.md', 'woodstock.md', 'typo.md']);
    expect(within(list).getByRole('button', { name: /Woodstock/ }).textContent).toContain('(approximate)');
    expect(within(list).getByRole('button', { name: /Typo/ }).textContent).toContain('End date ignored');
    expect(container.querySelector('.tl-undated')).toBeTruthy();
    await fireEvent.click(within(list).getByRole('button', { name: /Moon landing/ }));
    expect(onOpenNote).toHaveBeenCalledWith('moon.md');
  });
});

describe('read-only (an embed) and export', () => {
  it('an embed has no zoom/pan controls and writes nothing; arrows still step', async () => {
    vi.useFakeTimers();
    const { event, domain, onStateChange, container } = setup({ readOnly: true, from: '1960', to: '1979' });
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Fit' })).toBeNull();
    expect(screen.getByRole('button', { name: 'List' })).toBeTruthy();
    const before = domain();
    event('moon.md').focus();
    await fireEvent.keyDown(event('moon.md'), { key: '+' });
    await fireEvent.keyDown(event('moon.md'), { key: 'ArrowRight', shiftKey: true });
    await fireEvent.wheel(container.querySelector('.tl-viewport')!, { deltaY: -120 });
    expect(domain()).toEqual(before);
    await fireEvent.keyDown(event('moon.md'), { key: 'ArrowRight' });
    await vi.runAllTimersAsync();
    expect(document.activeElement).toBe(event('woodstock.md'));
    expect(onStateChange).not.toHaveBeenCalled();
  });

});

describe('export mode (#2609)', () => {
  const titles = (els: Iterable<Element>) => [...els].map((e) => e.querySelector('.tl-list-title')?.textContent);

  it('draws one fixed-width picture: no controls, tab stops, hover ring or card; every event linked by its note path', async () => {
    const { container, event, plot } = setup({ exportMode: true });
    expect(container.querySelector('.tl-toolbar')).toBeNull();
    expect(container.querySelector('button.tl-btn')).toBeNull();
    expect(plot().getAttribute('width')).toBe('760');
    expect(plot().getAttribute('viewBox')).toBe(`0 0 760 ${plot().getAttribute('height')}`);
    expect(container.querySelector('.tl-axis')!.getAttribute('viewBox')).toBe('0 0 760 28');
    const events = [...container.querySelectorAll<SVGGElement>('[data-timeline-event]')];
    expect(events.map((g) => g.dataset['notePath']).sort()).toEqual(['apollo.md', 'decade.md', 'moon.md', 'typo.md', 'woodstock.md']);
    for (const g of events) {
      expect(g.hasAttribute('tabindex')).toBe(false);
      // A link only once main gives it an href: under inline-title it is plain text.
      expect(g.hasAttribute('role')).toBe(false);
      expect(g.getAttribute('aria-label')).toBeTruthy();
    }
    expect(container.querySelector('.tl-ring')).toBeNull();
    await fireEvent.pointerEnter(event('moon.md'));
    expect(container.querySelector('[role="tooltip"]')).toBeNull();
  });

  it('lists every event in range after the drawing, in time order, with dates, approximate and a flagged end', () => {
    const { container } = setup({ exportMode: true });
    const rows = container.querySelectorAll('.tl-export-events .tl-export-row');
    expect(titles(rows)).toEqual(['The sixties', 'Apollo 11', 'Moon landing', 'Woodstock', 'Typo']);
    for (const r of rows) expect(r.querySelector('[data-note-path]')).toBe(r.querySelector('.tl-list-title'));
    const text = (t: string) => [...rows].find((r) => r.textContent.includes(t))!.textContent.replace(/\s+/g, ' ');
    expect(text('Woodstock')).toContain('(approximate)');
    expect(text('Moon landing')).toContain('1969');
    expect(text('Moon landing')).not.toContain('approximate');
    expect(text('Typo')).toContain('End date ignored');
    expect(container.querySelector('.tl-export-events h3')!.textContent).toMatch(/Dated\s*5/);
  });

  it('says what the hatch means when an approximate event is drawn, and not otherwise', () => {
    const { container } = setup({ exportMode: true });
    const legend = container.querySelector('.tl-legend')!;
    expect(legend.textContent).toContain('approximate');
    expect(legend.querySelector('rect')!.getAttribute('fill')).toBe(`url(#${container.querySelector('pattern')!.id})`);
    cleanup();
    const { container: exact } = setup({ exportMode: true, instances: EVENTS.slice(0, 2) });
    expect(exact.querySelector('.tl-legend')).toBeNull();
  });

  it('draws the spec range only: events outside it are neither drawn nor listed, and are counted', () => {
    const { container } = setup({ exportMode: true, from: '1969-07-01', to: '1969-07-31' });
    expect([...container.querySelectorAll<SVGGElement>('[data-timeline-event]')].map((g) => g.dataset['notePath']).sort()).toEqual(['apollo.md', 'decade.md', 'moon.md']);
    expect(titles(container.querySelectorAll('.tl-export-row'))).toEqual(['The sixties', 'Apollo 11', 'Moon landing']);
    expect(container.querySelector('.tl-outside')!.textContent).toBe('2 more fall outside this range.');
  });

  it('caps the drawing at 30 lanes and names the rest in a "+N more" note; they are still listed', () => {
    const many = Array.from({ length: 33 }, (_, i) => row(`w${i}.md`, `Week ${String(i).padStart(2, '0')}`, '1969-07-16', '1969-07-24'));
    const { container, plot } = setup({ exportMode: true, instances: many });
    expect(plot().dataset['lanes']).toBe('30');
    expect(container.querySelectorAll('[data-timeline-event]')).toHaveLength(30);
    expect(container.querySelector('.tl-more')!.textContent).toBe('+3 more not drawn (past 30 lanes): Week 30, Week 31, Week 32.');
    expect(container.querySelectorAll('.tl-export-row')).toHaveLength(33);
  });

  it('exports the Undated tray as a short list', () => {
    const { container } = setup({ exportMode: true });
    const undated = container.querySelector('.tl-undated')!;
    expect([...undated.querySelectorAll('[data-note-path]')].map((e) => e.getAttribute('data-note-path'))).toEqual(['someday.md', 'bad.md']);
    expect(undated.textContent).toContain('No date');
  });

  it('with nothing dated: says so, and the Undated list is the export', () => {
    const { container } = setup({ exportMode: true, instances: EVENTS.slice(5) });
    expect(container.querySelector('.tl-plot')).toBeNull();
    expect(container.querySelector('.tl-empty')!.textContent).toContain('has a date yet');
    expect(container.querySelectorAll('.tl-undated [data-note-path]')).toHaveLength(2);
  });

  it('when the drawing fails, falls back to the dated list — never a blank or the raw spec', () => {
    exportFails.on = true;
    try {
      const { container } = setup({ exportMode: true });
      expect(container.querySelector('.tl-plot')).toBeNull();
      expect(container.querySelector('.tl-fallback')!.textContent).toContain("couldn't be drawn");
      expect(titles(container.querySelectorAll('.tl-export-row'))).toEqual(['The sixties', 'Apollo 11', 'Moon landing', 'Woodstock', 'Typo']);
      expect(container.querySelectorAll('.tl-undated [data-note-path]')).toHaveLength(2);
    } finally {
      exportFails.on = false;
    }
  });

  it('the live view has no export list or notes', () => {
    const { container } = setup();
    expect(container.querySelector('.tl-export-events, .tl-export-note')).toBeNull();
  });
});

describe('virtualised above the threshold', () => {
  it('draws only what is in view, and keeps one tab stop and the keyboard order', async () => {
    const many = Array.from({ length: 1500 }, (_, i) => row(`e${String(i).padStart(4, '0')}.md`, `E${i}`, `${1000 + i}-06-01`));
    const { container, event } = setup({ instances: many, from: '1500', to: '1509' });
    const drawn = container.querySelectorAll('[data-timeline-event]').length;
    expect(drawn).toBeLessThan(100);
    expect(drawn).toBeGreaterThan(9);
    expect(container.querySelectorAll('[data-timeline-event][tabindex="0"]')).toHaveLength(1);
    const first = container.querySelector<SVGGElement>('[data-timeline-event][tabindex="0"]')!;
    expect(first.dataset['notePath']).toBe('e0500.md'); // the first in view
    first.focus();
    await fireEvent.keyDown(first, { key: 'Home' });
    await waitFor(() => expect(document.activeElement).toBe(event('e0000.md')));
    await fireEvent.keyDown(document.activeElement!, { key: 'ArrowRight' });
    await waitFor(() => expect(document.activeElement).toBe(event('e0001.md')));
  });
});
