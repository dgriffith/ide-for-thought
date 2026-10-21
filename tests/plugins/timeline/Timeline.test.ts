/**
 * @vitest-environment happy-dom
 *
 * The Timeline layout (#2608), as the Timeline plugin draws it (#2829):
 * points and bars, partial dates drawn as hatched spans, lanes for overlaps,
 * the Undated tray, every keyboard binding on a single roving tab stop,
 * zoom/pan/Fit writing `from`/`to` back through `view.setState` (Fit bounded
 * by a range filter), the preview it asks the app for — a backwards `end`
 * flagged on it — the list alternative, the read-only embed, and export
 * mode (#2609). The view is built the way the host builds it, and the
 * plugin API is a fake that records each call.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, within, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import Timeline from '../../../plugins/timeline/src/Timeline.svelte';
import type { PluginViewState } from '../../../plugin-api/index';
import { fakeMinerva } from '../kanban/fixtures';
import { civilMs } from '../../../src/shared/objects/date-precision';
import { timelineDomain } from '../../../src/shared/objects/timeline';
import type { TypeInstanceRow } from '../../../src/shared/objects/type-def';
import { silenceLogTags } from '../../helpers/quiet-logs';

const exportFails = vi.hoisted(() => ({ on: false }));
// Lets one test make the export drawing throw, to see the fallback list.
vi.mock('../../../plugins/timeline/src/timeline-export', async (orig) => {
  const real = await orig<typeof import('../../../plugins/timeline/src/timeline-export')>();
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

type Over = {
  instances?: TypeInstanceRow[];
  properties?: typeof EVENT.properties;
  filters?: PluginViewState['filters'];
  from?: string | null;
  to?: string | null;
  dateBy?: string | null;
  readOnly?: boolean;
  exportMode?: boolean;
};

/** The view as Minerva sends it (`PluginLayout`): the spec's own fields, the filters, the instances. */
function viewOf(o: Over): PluginViewState {
  const properties = o.properties ?? EVENT.properties;
  return {
    layout: 'timeline',
    type: { id: EVENT.id, label: EVENT.label, icon: EVENT.icon },
    properties: properties.map((p) => ({ name: p.name, type: p.type, ...('label' in p && p.label ? { label: p.label } : {}) })),
    visible: null,
    instances: (o.instances ?? EVENTS).map((i) => ({ path: i.path, title: i.title, values: { ...i.values }, fields: [] })),
    sortColumn: null, sortDir: 'asc',
    spec: { from: o.from ?? null, to: o.to ?? null, dateBy: o.dateBy ?? null },
    filters: o.filters ?? [],
    readOnly: o.readOnly ?? false, exportMode: o.exportMode ?? false,
    selected: [], selectable: false, rowMenu: false,
    groupProperty: null, groups: [], movable: false, canUndoMove: false, lastMove: null,
  };
}

function setup(over: Over = {}) {
  const api = fakeMinerva();
  // What the old component's callbacks were, read off the calls the plugin makes.
  const onStateChange = vi.fn();
  const onOpenNote = vi.fn();
  const m = api.minerva as unknown as { view: Record<string, (p: never) => Promise<unknown>> };
  m.view['setState'] = vi.fn(async (p: { patch: Record<string, unknown> }) => { api.calls.push({ method: 'view.setState', params: p }); onStateChange(p.patch); return {}; });
  m.view['click'] = vi.fn(async (p: { path: string }) => { api.calls.push({ method: 'view.click', params: p }); onOpenNote(p.path); return {}; });
  let current: Over = { ...over };
  const utils = render(Timeline, { minerva: api.minerva, view: viewOf(current), locale: 'en-GB' });
  const event = (path: string) => utils.container.querySelector<SVGGElement>(`[data-timeline-event][data-note-path="${path}"]`)!;
  const plot = () => utils.container.querySelector<SVGSVGElement>('.tl-plot')!;
  const domain = () => ({ start: Number(plot().dataset['domainStart']), end: Number(plot().dataset['domainEnd']) });
  /** A new view from Minerva, as the old component got new props. */
  const rerender = async (patch: Over) => { current = { ...current, ...patch }; await utils.rerender({ view: viewOf(current) }); };
  return { ...utils, rerender, api, onStateChange, onOpenNote, event, plot, domain };
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

  // The preview is the app's own (#2710, #2829): the plugin asks for it,
  // with the event's dates as extra lines, and the Date by and end left off
  // its field strip, which the host draws (PluginFrame/PluginLayout tests).
  const previews = (api: ReturnType<typeof fakeMinerva>) => api.of('ui.previewNote') as Array<{ path: string; via: string; extra: string[]; omit: string[] }>;

  it("hovering asks for the app's preview: the dates as its lines, the dates off its fields; leaving lets it go", async () => {
    const { event, api } = setup();
    await fireEvent.pointerEnter(event('moon.md'));
    expect(previews(api)).toEqual([expect.objectContaining({ path: 'moon.md', via: 'pointer', omit: ['date', 'end'] })]);
    expect(previews(api)[0]!.extra.join(' ')).toContain('20 Jul 1969');
    await fireEvent.pointerLeave(event('moon.md'));
    expect(api.of('ui.hidePreview')).toEqual([{ path: 'moon.md', via: 'pointer' }]);
  });

  it('flags a backwards end on the preview, and keeps the event at its start', async () => {
    const { event, api } = setup();
    expect(event('typo.md').hasAttribute('data-end-issue')).toBe(true);
    expect(event('typo.md').getAttribute('aria-label')).toBe('Typo, 1 May 1972 (end date ignored)');
    await fireEvent.pointerEnter(event('typo.md'));
    expect(previews(api)[0]!.extra.join(' ')).toContain('End date ignored: 1971-01-01 is before the start');
  });

  it('a partial date says it is approximate on the preview', async () => {
    const { event, api } = setup();
    await fireEvent.pointerEnter(event('woodstock.md'));
    expect(previews(api)[0]!.extra[0]).toContain('approximate');
  });

  it('nothing is previewed in an export', async () => {
    const { event, api } = setup({ exportMode: true });
    await fireEvent.pointerEnter(event('moon.md'));
    expect(api.of('ui.previewNote')).toEqual([]);
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

  it("focusing an event by keyboard asks for its preview, and the preview's text describes it", async () => {
    const { event, api } = setup();
    event('typo.md').focus();
    await tick();
    expect(api.of('ui.previewNote')).toEqual([expect.objectContaining({ path: 'typo.md', via: 'focus' })]);
    // The app's preview is outside the frame; Minerva sends its text back.
    api.emit('preview', { path: 'typo.md', description: 'Typo — End date ignored' });
    await tick();
    const id = event('typo.md').getAttribute('aria-describedby')!;
    expect(document.getElementById(id)!.textContent).toBe('Typo — End date ignored');
    api.emit('preview', { path: 'typo.md', description: null });
    await tick();
    expect(event('typo.md').hasAttribute('aria-describedby')).toBe(false);
  });

  it('a zoom still waiting to be written goes before the note it opens, and when the frame loses focus (#2829)', async () => {
    vi.useFakeTimers();
    const { event, api } = setup({ from: '1960', to: '1979' });
    event('moon.md').focus();
    await fireEvent.keyDown(event('moon.md'), { key: '+' });
    await fireEvent.keyDown(event('moon.md'), { key: 'Enter' });
    // Opening a note can take the view away with nothing run in the frame: the range is written first.
    expect(api.calls.map((c) => c.method).filter((m) => m === 'view.setState' || m === 'view.click')).toEqual(['view.setState', 'view.click']);
    await fireEvent.keyDown(event('moon.md'), { key: '-' });
    window.dispatchEvent(new Event('blur'));
    expect(api.of('view.setState')).toHaveLength(2);
    vi.advanceTimersByTime(1000);
    expect(api.of('view.setState')).toHaveLength(2); // and not again when the debounce would have run
  });

  it('Escape closes the preview and keeps focus; with none up, it is left to the runtime', async () => {
    const { event, api } = setup();
    event('moon.md').focus();
    await tick();
    const first = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    event('moon.md').dispatchEvent(first);
    expect(first.defaultPrevented).toBe(true);
    expect(api.of('ui.hidePreview')).toEqual(expect.arrayContaining([{ path: 'moon.md', via: 'focus' }]));
    expect(document.activeElement).toBe(event('moon.md'));
    const second = new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true });
    event('moon.md').dispatchEvent(second);
    expect(second.defaultPrevented).toBe(false); // the runtime gives focus back to Minerva
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
