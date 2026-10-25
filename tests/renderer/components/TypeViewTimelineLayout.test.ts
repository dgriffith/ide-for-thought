/**
 * @vitest-environment jsdom
 *
 * A type view's Timeline layout (#2607, #2608, #2715), end to end in the
 * renderer: since #2829 the timeline is the built-in Timeline plugin's, so
 * these run it in loopback (`plugin-loopback.ts`) — its real view, drawn
 * beside the frame from the view TypeView sends, its range written back
 * through the host. jsdom, not happy-dom, which logs an error for every
 * plugin frame it won't load. The drawing itself is tested in
 * tests/plugins/timeline/.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const h = vi.hoisted(() => ({
  instances: vi.fn(), list: vi.fn(), noteTypeMap: vi.fn(),
  loop: {} as import('./plugin-loopback').LoopbackState,
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: h.instances, list: h.list, noteTypeMap: h.noteTypeMap }, app: { getSystemLocale: async () => 'en-GB' } },
}));
vi.mock('../../../src/renderer/lib/stores/plugin-sessions.svelte', () => ({ connectPluginFrame: (...a: unknown[]) => h.loop.connect(...a) }));
vi.mock('../../../src/renderer/lib/stores/code-plugins.svelte', () => ({ codePluginsStore: { isOn: () => true, name: () => 'Timeline' } }));

import TypeView from '../../../src/renderer/lib/components/TypeView.svelte';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';
import { parseObjectViewSpec } from '../../../src/renderer/lib/markdown/object-view-renderer';
import { autoLoadPluginFrames, pluginLoopback } from './plugin-loopback';

// The drawing measures its width with a ResizeObserver, which jsdom lacks.
if (!('ResizeObserver' in globalThis)) {
  vi.stubGlobal('ResizeObserver', class { observe() {} unobserve() {} disconnect() {} });
}

function props(over: Record<string, unknown> = {}) {
  return {
    typeId: 'event', layout: 'timeline' as const, sortColumn: null, sortDir: 'asc' as const, columns: null,
    revision: 0, onStateChange: vi.fn(), onOpenNote: vi.fn(), ...over,
  };
}

describe('timeline layout (#2607, #2608, #2715)', () => {
  const EVENT = {
    id: 'event', label: 'Event', classLocalName: 'Event', icon: '📅', source: 'stock' as const,
    properties: [
      { name: 'date', type: 'date' as const },
      { name: 'end', type: 'date' as const },
      { name: 'location', type: 'link-to-type' as const, targetType: 'place' },
    ],
  };
  const CONFERENCE = { id: 'conference', label: 'Conference', classLocalName: 'Conference', icon: '🎤', parent: 'event', source: 'user' as const, properties: [] };
  const MEETING = { id: 'meeting', label: 'Meeting', classLocalName: 'Meeting', icon: '🗓️', parent: 'event', source: 'stock' as const, properties: [{ name: 'organizer', type: 'text' as const }] };
  // A dated type that isn't Event: Timeline is offered by having a date property, not by ancestry (#2715).
  const ALBUM = {
    id: 'album', label: 'Album', classLocalName: 'Album', icon: '💿', source: 'user' as const,
    properties: [{ name: 'artist', type: 'text' as const }, { name: 'published', type: 'date' as const }],
  };
  const ALBUMS = [
    { path: 'abbey.md', title: 'Abbey Road', values: { artist: 'The Beatles', published: '1969-09-26' }, cover: null },
    { path: 'kind.md', title: 'Kind of Blue', values: { artist: 'Miles Davis', published: '1959' }, cover: null },
  ];
  // An Event subtype with a second date property: two Date by choices (`end` isn't one beside `date`).
  const EXPEDITION = {
    id: 'expedition', label: 'Expedition', classLocalName: 'Expedition', icon: '🧭', parent: 'event', source: 'user' as const,
    properties: [{ name: 'announced', type: 'date' as const }],
  };
  const TRIPS = [
    { path: 'apollo.md', title: 'Apollo 11', values: { date: '1969-07-16', end: '1969-07-24', announced: '1969-01-09', location: null }, cover: null },
    { path: 'kon.md', title: 'Kon-Tiki', values: { date: '1947-04-28', end: '1947-08-07', announced: '1946-11-01', location: null }, cover: null },
  ];
  const EVENTS = [
    { path: 'moon.md', title: 'Moon landing', values: { date: '1969-07-20', end: null, location: null }, cover: null },
    { path: 'war.md', title: 'Thirty Years War', values: { date: '1618', end: '1648', location: null }, cover: null },
  ];
  let writeText: ReturnType<typeof vi.fn>;
  beforeEach(async () => {
    pluginLoopback(h.loop, () => import('../../../plugins/timeline/src/App.svelte'));
    writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    h.list.mockResolvedValue({ types: [EVENT, CONFERENCE, MEETING, ALBUM, EXPEDITION], errors: [] });
    h.noteTypeMap.mockResolvedValue({});
    await objectTypesStore.refresh();
  });
  let stopAutoLoad = () => {};
  beforeEach(() => { stopAutoLoad = autoLoadPluginFrames(); });
  afterEach(() => { stopAutoLoad(); cleanup(); });
  const copied = async () => {
    await fireEvent.click(screen.getByText('Copy as markdown'));
    const md = writeText.mock.calls.at(-1)![0] as string;
    return { md, spec: parseObjectViewSpec(md.replace(/^```object-view\n/, '').replace(/\n```\n$/, '')) };
  };
  const drawn = (root: HTMLElement) => [...root.querySelectorAll<SVGGElement>('[data-timeline-event]')].map((e) => e.dataset['notePath']);
  /** Each drawn event's accessible name: a bar's carries its end ("… – …"), a point's doesn't. */
  const names = (root: HTMLElement) => [...root.querySelectorAll<SVGGElement>('[data-timeline-event]')].map((e) => e.getAttribute('aria-label'));
  const dateBy = () => screen.queryByRole<HTMLSelectElement>('combobox', { name: 'Date by' });

  it('a type dated by `published` draws points placed by it, with no Date by picker (one choice)', async () => {
    h.instances.mockResolvedValue({ type: ALBUM, instances: ALBUMS });
    const { container } = render(TypeView, props({ typeId: 'album', layout: 'timeline' }));
    await waitFor(() => expect(drawn(container).sort()).toEqual(['abbey.md', 'kind.md']));
    expect(names(container)).toEqual(expect.arrayContaining(['Abbey Road, Sep 26, 1969', 'Kind of Blue, 1959']));
    expect(dateBy()).toBeNull();
  });

  it('an Event timeline still draws bars from date/end, and offers no Date by (`end` is not a choice)', async () => {
    h.instances.mockResolvedValue({ type: EVENT, instances: EVENTS });
    const { container } = render(TypeView, props({ typeId: 'event', layout: 'timeline', from: '1600', to: '1975' }));
    await waitFor(() => expect(drawn(container)).toEqual(['moon.md', 'war.md']));
    expect(names(container).find((n) => n!.startsWith('Thirty Years War'))).toBe('Thirty Years War, 1618 – 1648');
    expect(dateBy()).toBeNull();
  });

  it('Date by shows on a timeline only when there is more than one date property, and a pick writes dateBy', async () => {
    h.instances.mockResolvedValue({ type: EXPEDITION, instances: TRIPS });
    const onStateChange = vi.fn();
    render(TypeView, props({ typeId: 'expedition', layout: 'list', onStateChange }));
    await screen.findByText('Apollo 11');
    expect(dateBy()).toBeNull(); // not on another layout
    cleanup();
    render(TypeView, props({ typeId: 'expedition', layout: 'timeline', onStateChange }));
    await waitFor(() => expect(dateBy()).toBeTruthy());
    expect([...dateBy()!.options].map((o) => o.value)).toEqual(['date', 'announced']);
    expect(dateBy()!.value).toBe('date'); // the default
    await fireEvent.change(dateBy()!, { target: { value: 'announced' } });
    expect(onStateChange).toHaveBeenCalledWith({ dateBy: 'announced' });
  });

  it('an Event timeline dated by another date property draws points by it, not bars', async () => {
    h.instances.mockResolvedValue({ type: EXPEDITION, instances: TRIPS });
    const { container } = render(TypeView, props({ typeId: 'expedition', layout: 'timeline', dateBy: 'announced' }));
    await waitFor(() => expect(drawn(container).sort()).toEqual(['apollo.md', 'kon.md']));
    expect(names(container).sort()).toEqual(['Apollo 11, Jan 9, 1969', 'Kon-Tiki, Nov 1, 1946']);
    expect(dateBy()!.value).toBe('announced');
  });

  it('Copy as markdown keeps a timeline\'s valid dateBy and drops an invalid one', async () => {
    h.instances.mockResolvedValue({ type: EXPEDITION, instances: TRIPS });
    render(TypeView, props({ typeId: 'expedition', layout: 'timeline', dateBy: 'announced' }));
    await screen.findByText('Copy as markdown');
    expect((await copied()).spec).toMatchObject({ typeId: 'expedition', layout: 'timeline', dateBy: 'announced' });
    cleanup();
    const { container } = render(TypeView, props({ typeId: 'expedition', layout: 'timeline', dateBy: 'end' }));
    await waitFor(() => expect(drawn(container)).toHaveLength(2)); // judged once the type has loaded
    const { md, spec } = await copied();
    expect(md).not.toContain('"dateBy"');
    expect(spec).toMatchObject({ layout: 'timeline', dateBy: null });
  });

  it('an Event spec that says timeline draws the timeline, in the panel and (read-only) in an embed', async () => {
    h.instances.mockResolvedValue({ type: EVENT, instances: EVENTS });
    const panel = render(TypeView, props({ typeId: 'event', layout: 'timeline', from: '1600', to: '1975' }));
    await waitFor(() => expect(drawn(panel.container)).toEqual(['moon.md', 'war.md']));
    expect(screen.getByRole('tab', { name: 'Timeline' }).getAttribute('aria-selected')).toBe('true');
    expect(screen.getByRole('button', { name: 'Fit' })).toBeTruthy();
    cleanup();
    const embed = render(TypeView, props({ typeId: 'event', layout: 'timeline', chromeless: true }));
    await waitFor(() => expect(drawn(embed.container)).toEqual(['moon.md', 'war.md']));
    expect(screen.queryByRole('button', { name: 'Fit' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).toBeNull();
  });

  it('a range filter on the date applies to the timeline, and zooming writes from/to through onStateChange', async () => {
    h.instances.mockResolvedValue({ type: EVENT, instances: EVENTS });
    const onStateChange = vi.fn();
    const { container } = render(TypeView, props({ typeId: 'event', layout: 'timeline', filters: [{ property: 'date', min: '1900', max: null }], onStateChange }));
    await waitFor(() => expect(drawn(container)).toEqual(['moon.md']));
    // The plugin is told the filter too, so its Fit stays inside it (#2829).
    expect(h.loop.views.at(-1)!.filters).toEqual([{ property: 'date', min: '1900', max: null }]);
    await fireEvent.click(screen.getByRole('button', { name: 'Zoom in' }));
    await waitFor(() => expect(onStateChange).toHaveBeenCalledWith({ from: expect.any(String), to: expect.any(String) }));
  });

  it('Copy as markdown keeps a timeline and its range for Event, and omits fit all', async () => {
    h.instances.mockResolvedValue({ type: EVENT, instances: EVENTS });
    render(TypeView, props({ typeId: 'event', layout: 'timeline', from: '-0043', to: '1975-06' }));
    await screen.findByText('Copy as markdown');
    expect((await copied()).spec).toMatchObject({ typeId: 'event', layout: 'timeline', from: '-0043', to: '1975-06' });
    cleanup();
    render(TypeView, props({ typeId: 'event', layout: 'timeline' }));
    await screen.findByText('Copy as markdown');
    const { md, spec } = await copied();
    expect(md).not.toContain('"from"');
    expect(md).not.toContain('"to"');
    expect(spec).toMatchObject({ layout: 'timeline', from: null, to: null });
  });

  it('a user subtype of Event keeps its timeline too', async () => {
    h.instances.mockResolvedValue({ type: CONFERENCE, instances: EVENTS });
    const { container } = render(TypeView, props({ typeId: 'conference', layout: 'timeline', from: '1960' }));
    await waitFor(() => expect(drawn(container)).toEqual(['moon.md', 'war.md']));
    expect((await copied()).spec).toMatchObject({ typeId: 'conference', layout: 'timeline', from: '1960', to: null });
  });

});
