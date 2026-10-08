/**
 * @vitest-environment happy-dom
 *
 * Live Typed-Objects view embedded in a note (#2067). Hydration mounts a
 * real, chromeless `TypeView` into the placeholder — mocked here the same
 * way `TypeView.test.ts` mocks `api.types.instances`, since this exercises
 * the actual mount/unmount lifecycle, not a stubbed component.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitFor } from '@testing-library/svelte';

const { instancesMock, listMock, noteTypeMapMock } = vi.hoisted(() => ({
  instancesMock: vi.fn(),
  listMock: vi.fn(),
  noteTypeMapMock: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: instancesMock, list: listMock, noteTypeMap: noteTypeMapMock } },
}));

import { hydrateObjectViewBlocks, parseObjectViewSpec } from '../../../src/renderer/lib/markdown/object-view-renderer';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';
import { disposeCaches } from '../../../src/renderer/lib/markdown/hydrated-block-cache';

const TYPE = {
  id: 'book',
  label: 'Book',
  classLocalName: 'Book',
  icon: '📖',
  source: 'stock' as const,
  properties: [{ name: 'author', type: 'text' as const, label: 'Author' }],
};
const INSTANCES = [{ path: 'Dune.md', title: 'Dune', values: { author: 'Frank Herbert' }, cover: null }];

/** A `.preview`-alike root holding one unrendered object-view placeholder. */
function previewWith(specText: string): HTMLElement {
  const root = document.createElement('div');
  const block = document.createElement('div');
  block.className = 'object-view-block';
  block.textContent = specText;
  root.appendChild(block);
  document.body.appendChild(root);
  return root;
}

function deps(over: Partial<Parameters<typeof hydrateObjectViewBlocks>[1]> = {}) {
  return { revision: 0, onOpenNote: vi.fn(), ...over };
}

beforeEach(async () => {
  instancesMock.mockResolvedValue({ type: TYPE, instances: INSTANCES });
  listMock.mockResolvedValue({ types: [TYPE], errors: [] });
  noteTypeMapMock.mockResolvedValue({});
  await objectTypesStore.refresh();
});

afterEach(() => {
  document.body.innerHTML = '';
  instancesMock.mockReset();
});

describe('parseObjectViewSpec (#2067)', () => {
  it('parses a minimal valid spec, defaulting sort/columns', () => {
    expect(parseObjectViewSpec('{"typeId":"book","layout":"list"}')).toEqual({
      typeId: 'book',
      layout: 'list',
      sortColumn: null,
      sortDir: 'asc',
      columns: null,
      folder: null,
      filters: [],
      mapStyle: 'auto',
      height: 360,
      groupBy: null,
      columnOrder: [],
      showEmptyColumns: true,
      from: null,
      to: null,
      month: null,
      dateBy: null,
    });
  });

  it('carries through explicit sort/columns', () => {
    expect(parseObjectViewSpec('{"typeId":"book","layout":"table","sortColumn":"author","sortDir":"desc","columns":["author"]}'))
      .toEqual({ typeId: 'book', layout: 'table', sortColumn: 'author', sortDir: 'desc', columns: ['author'], folder: null, filters: [], mapStyle: 'auto', height: 360, groupBy: null, columnOrder: [], showEmptyColumns: true, from: null, to: null, month: null, dateBy: null });
  });

  it('reads columnOrder and showEmptyColumns, dropping invalid shapes rather than throwing (#2614)', () => {
    const spec = (extra: string) => parseObjectViewSpec(`{"typeId":"project","layout":"kanban"${extra}}`);
    expect(spec(',"columnOrder":["done","","active"],"showEmptyColumns":false')).toMatchObject({ columnOrder: ['done', '', 'active'], showEmptyColumns: false });
    expect(spec('')).toMatchObject({ columnOrder: [], showEmptyColumns: true });
    // Not an array → none; non-string entries and repeats dropped.
    expect(spec(',"columnOrder":"done"').columnOrder).toEqual([]);
    expect(spec(',"columnOrder":[1,"done",null,"done",{"x":1},"paused"]').columnOrder).toEqual(['done', 'paused']);
    // Only an explicit false hides empty columns.
    for (const v of ['0', '"false"', 'null', '"no"']) expect(spec(`,"showEmptyColumns":${v}`).showEmptyColumns).toBe(true);
  });

  it('accepts the kanban layout and reads groupBy, dropping a malformed one (#2601)', () => {
    expect(parseObjectViewSpec('{"typeId":"project","layout":"kanban","groupBy":"status"}')).toMatchObject({ layout: 'kanban', groupBy: 'status' });
    expect(parseObjectViewSpec('{"typeId":"project","layout":"kanban"}').groupBy).toBeNull();
    expect(parseObjectViewSpec('{"typeId":"project","layout":"kanban","groupBy":7}').groupBy).toBeNull();
    expect(parseObjectViewSpec('{"typeId":"project","layout":"kanban","groupBy":""}').groupBy).toBeNull();
  });

  it('accepts the timeline layout and reads from/to, dropping invalid values rather than throwing (#2607)', () => {
    const spec = (extra: string) => parseObjectViewSpec(`{"typeId":"event","layout":"timeline"${extra}}`);
    expect(spec('')).toMatchObject({ layout: 'timeline', from: null, to: null });
    expect(spec(',"from":"1960","to":"1975"')).toMatchObject({ from: '1960', to: '1975' });
    expect(spec(',"from":"1969-07-20","to":"1969-07-24"')).toMatchObject({ from: '1969-07-20', to: '1969-07-24' });
    expect(spec(',"from":"-0043","to":"0014"')).toMatchObject({ from: '-0043', to: '0014' }); // 44 BCE to AD 14
    expect(spec(',"from":1960,"to":1975')).toMatchObject({ from: '1960', to: '1975' }); // a number, as written
    // An invalid edge goes on its own; a `to` before `from` drops both (fit all).
    expect(spec(',"from":"someday","to":"1975"')).toMatchObject({ from: null, to: '1975' });
    expect(spec(',"from":"1960","to":{"y":1975}')).toMatchObject({ from: '1960', to: null });
    expect(spec(',"from":"1975","to":"1960"')).toMatchObject({ from: null, to: null });
    // A clock value is a range edge too, since #2608 zooms below a day.
    expect(spec(',"from":"1969-07-20T20:17"')).toMatchObject({ from: '1969-07-20T20:17' });
    // The type isn't known to the parser, so any type's timeline is kept as written.
    expect(parseObjectViewSpec('{"typeId":"book","layout":"timeline","from":"1960"}')).toMatchObject({ layout: 'timeline', from: '1960' });
  });

  it('accepts the calendar layout and reads month/dateBy, dropping invalid values rather than throwing (#2701)', () => {
    const spec = (extra: string) => parseObjectViewSpec(`{"typeId":"book","layout":"calendar"${extra}}`);
    expect(spec('')).toMatchObject({ layout: 'calendar', month: null, dateBy: null });
    expect(spec(',"month":"2026-10","dateBy":"published"')).toMatchObject({ month: '2026-10', dateBy: 'published' });
    expect(spec(',"month":"-0043-03"')).toMatchObject({ month: '-0043-03' }); // March 44 BCE
    // Anything but a month is dropped on its own: a day, a year, a number, junk.
    for (const bad of ['"2026-10-07"', '"2026"', '202610', '"soon"', '{"y":2026}']) {
      expect(spec(`,"month":${bad},"dateBy":"published"`)).toMatchObject({ month: null, dateBy: 'published' });
    }
    expect(spec(',"dateBy":""')).toMatchObject({ dateBy: null });
    expect(spec(',"dateBy":7')).toMatchObject({ dateBy: null });
    // The type isn't known to the parser, so any dateBy string, and any type's calendar, is kept as written.
    expect(parseObjectViewSpec('{"typeId":"place","layout":"calendar","dateBy":"name"}')).toMatchObject({ layout: 'calendar', dateBy: 'name' });
    expect(() => parseObjectViewSpec('{"typeId":"book","layout":"agenda"}')).toThrow(/"calendar"/);
  });

  it('reads mapStyle: light/dark kept, anything else auto (#2665)', () => {
    expect(parseObjectViewSpec('{"typeId":"place","layout":"map","mapStyle":"dark"}').mapStyle).toBe('dark');
    expect(parseObjectViewSpec('{"typeId":"place","layout":"map","mapStyle":"light"}').mapStyle).toBe('light');
    expect(parseObjectViewSpec('{"typeId":"place","layout":"map","mapStyle":"sepia"}').mapStyle).toBe('auto');
    expect(parseObjectViewSpec('{"typeId":"place","layout":"map","mapStyle":1}').mapStyle).toBe('auto');
  });

  it('throws on malformed JSON', () => {
    expect(() => parseObjectViewSpec('{not json')).toThrow();
  });

  it('throws when typeId is missing', () => {
    expect(() => parseObjectViewSpec('{"layout":"list"}')).toThrow(/typeId/);
  });

  it('throws when layout is missing or invalid', () => {
    expect(() => parseObjectViewSpec('{"typeId":"book"}')).toThrow(/layout/);
    expect(() => parseObjectViewSpec('{"typeId":"book","layout":"chart"}')).toThrow(/layout/);
  });
});

describe('hydrateObjectViewBlocks (#2067)', () => {
  it('mounts a chromeless TypeView for a valid spec', async () => {
    const root = previewWith('{"typeId":"book","layout":"list"}');
    hydrateObjectViewBlocks(root, deps());

    const block = root.querySelector('.object-view-block')!;
    await waitFor(() => expect(block.getAttribute('data-object-view-rendered')).toBe('ok'));
    await waitFor(() => expect(block.textContent).toContain('Dune'));
    // Chromeless: no header/switcher chrome leaked into the note.
    expect(block.querySelector('.tv-header')).toBeNull();
  });

  it('a kanban embed is a read-only board: no drag, no Move to, no column menu, no pickers (#2604)', async () => {
    const PROJECT = {
      id: 'project', label: 'Project', classLocalName: 'Project', icon: '🚀', source: 'stock' as const,
      properties: [{ name: 'status', type: 'enum' as const, options: ['active', 'done'] }],
    };
    instancesMock.mockResolvedValue({ type: PROJECT, instances: [
      { path: 'p/Shed.md', title: 'Garden Shed', values: { status: 'active' }, cover: null },
    ] });
    const root = previewWith('{"typeId":"project","layout":"kanban","groupBy":"status"}');
    const onOpenNote = vi.fn();
    hydrateObjectViewBlocks(root, deps({ onOpenNote }));
    const block = root.querySelector('.object-view-block')!;
    await waitFor(() => expect(block.querySelector('.kb-card')).not.toBeNull());

    // The preview's board scrolls; only an export wraps it.
    expect(block.querySelector('.kb-board')!.classList.contains('kb-export')).toBe(false);
    // No toolbar (Group by picker, Show empty columns), no column menu, no draggable header.
    expect(block.querySelector('.tv-header')).toBeNull();
    expect(block.querySelector('.kb-col-menu-btn')).toBeNull();
    expect(block.querySelector('[data-draggable]')).toBeNull();
    const card = block.querySelector<HTMLElement>('.kb-card')!;
    expect(card.hasAttribute('aria-pressed')).toBe(false); // nothing to select
    // Right-click and Shift+F10 open no Move to menu.
    card.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    card.dispatchEvent(new KeyboardEvent('keydown', { key: 'F10', shiftKey: true, bubbles: true }));
    await Promise.resolve();
    expect(document.querySelector('.tv-menu')).toBeNull();
    // A pointer drag starts nothing.
    card.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 5, clientY: 5, pointerId: 1, isPrimary: true }));
    window.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: 80, clientY: 80, pointerId: 1, isPrimary: true }));
    expect(document.querySelector('[data-kanban-ghost], [data-dragging]')).toBeNull();
    window.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, clientX: 80, clientY: 80, pointerId: 1, isPrimary: true }));
    // A click still opens the note.
    card.click();
    expect(onOpenNote).toHaveBeenCalledWith('p/Shed.md');
  });

  it('a timeline embed is read-only: no zoom/pan/Fit, a wheel moves nothing, not export mode; List and opening still work (#2608, pinned by #2609)', async () => {
    const EVENT = {
      id: 'event', label: 'Event', classLocalName: 'Event', icon: '📅', source: 'stock' as const,
      properties: [{ name: 'date', type: 'datetime' as const }, { name: 'end', type: 'datetime' as const }],
    };
    listMock.mockResolvedValue({ types: [TYPE, EVENT], errors: [] });
    await objectTypesStore.refresh();
    instancesMock.mockResolvedValue({ type: EVENT, instances: [
      { path: 'e/Moon.md', title: 'Moon landing', values: { date: '1969-07-20', end: null }, cover: null },
      { path: 'e/Apollo.md', title: 'Apollo 11', values: { date: '1969-07-16', end: '1969-07-24' }, cover: null },
    ] });
    const root = previewWith('{"typeId":"event","layout":"timeline","from":"1969-07","to":"1969-07"}');
    const onOpenNote = vi.fn();
    hydrateObjectViewBlocks(root, deps({ onOpenNote }));
    const block = root.querySelector('.object-view-block')!;
    await waitFor(() => expect(block.querySelector('[data-timeline-event]')).not.toBeNull());

    expect(block.querySelector('.tl')!.classList.contains('tl-export')).toBe(false);
    expect(block.querySelector('.tv-header')).toBeNull();
    const buttons = [...block.querySelectorAll('.tl-toolbar button')].map((b) => b.textContent.trim());
    expect(buttons).toEqual(['List']);
    expect(block.querySelector('.tl-viewport')!.classList.contains('tl-pannable')).toBe(false);
    const plot = block.querySelector<SVGSVGElement>('.tl-plot')!;
    const before = [plot.dataset['domainStart'], plot.dataset['domainEnd']];
    block.querySelector('.tl-viewport')!.dispatchEvent(new WheelEvent('wheel', { deltaY: -240, bubbles: true, cancelable: true }));
    const ev = block.querySelector<SVGGElement>('[data-timeline-event][data-note-path="e/Moon.md"]')!;
    ev.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
    await new Promise((r) => setTimeout(r, 400));
    expect([plot.dataset['domainStart'], plot.dataset['domainEnd']]).toEqual(before);
    // Not an export: no dated list under it.
    expect(block.querySelector('.tl-export-events')).toBeNull();
    ev.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onOpenNote).toHaveBeenCalledWith('e/Moon.md');
  });

  it('opens a note via the provided onOpenNote when a row is clicked', async () => {
    const root = previewWith('{"typeId":"book","layout":"list"}');
    const onOpenNote = vi.fn();
    hydrateObjectViewBlocks(root, deps({ onOpenNote }));

    const block = root.querySelector('.object-view-block')!;
    await waitFor(() => expect(block.textContent).toContain('Dune'));
    (block.querySelector('.tv-list-row') as HTMLElement).click();
    expect(onOpenNote).toHaveBeenCalledWith('Dune.md');
  });

  it('renders a clear inline error for malformed JSON, not a blank block', () => {
    const root = previewWith('{not json');
    hydrateObjectViewBlocks(root, deps());

    const block = root.querySelector('.object-view-block')!;
    expect(block.getAttribute('data-object-view-rendered')).toBe('error');
    expect(block.querySelector('.object-view-error')).not.toBeNull();
  });

  it('renders a clear inline error for an invalid layout', () => {
    const root = previewWith('{"typeId":"book","layout":"pie-chart"}');
    hydrateObjectViewBlocks(root, deps());

    const block = root.querySelector('.object-view-block')!;
    expect(block.getAttribute('data-object-view-rendered')).toBe('error');
    expect(block.textContent).toMatch(/layout/);
  });

  it('is idempotent — does not re-mount an already-rendered block', async () => {
    const root = previewWith('{"typeId":"book","layout":"list"}');
    hydrateObjectViewBlocks(root, deps());
    const block = root.querySelector('.object-view-block')!;
    await waitFor(() => expect(block.getAttribute('data-object-view-rendered')).toBe('ok'));

    instancesMock.mockClear();
    hydrateObjectViewBlocks(root, deps());
    expect(instancesMock).not.toHaveBeenCalled();
  });

  // Cleanup moved from `Preview.svelte`'s `activeViews` array into the block
  // cache in #2323 — the mount is preserved across render ticks, so the thing
  // that owns its lifetime has to be the thing that knows whether it survived.
  it('disposeCaches tears the live mount down', async () => {
    const root = previewWith('{"typeId":"book","layout":"list"}');
    hydrateObjectViewBlocks(root, deps());
    const block = root.querySelector('.object-view-block')!;
    await waitFor(() => expect(block.querySelector('.type-view, .object-view-error')).toBeTruthy());

    expect(() => disposeCaches(root)).not.toThrow();
    // Disposed, so the next render tick's fresh placeholder is a new mount
    // rather than a restore of a component that no longer exists.
    instancesMock.mockClear();
    root.innerHTML = '';
    const fresh = document.createElement('div');
    fresh.className = 'object-view-block';
    fresh.textContent = '{"typeId":"book","layout":"list"}';
    root.appendChild(fresh);
    hydrateObjectViewBlocks(root, deps());
    await waitFor(() => expect(instancesMock).toHaveBeenCalled());
  });

  // #2666: the embed's height comes from its spec, and a resize — which only
  // changes `height` — keeps the live mount rather than re-querying.
  it('sizes the box from data-view-height, and a resize re-adopts the mount', async () => {
    const root = previewWith('{"typeId":"book","layout":"list"}');
    const block = root.querySelector<HTMLElement>('.object-view-block')!;
    block.dataset.viewHeight = '360';
    hydrateObjectViewBlocks(root, deps());
    await waitFor(() => expect(block.textContent).toContain('Dune'));
    expect(block.style.height).toBe('360px');

    instancesMock.mockClear();
    root.innerHTML = '';
    const resized = document.createElement('div');
    resized.className = 'object-view-block';
    resized.dataset.viewHeight = '520';
    resized.textContent = '{"typeId":"book","layout":"list","height":520}';
    root.appendChild(resized);
    hydrateObjectViewBlocks(root, deps());
    expect(resized.getAttribute('data-object-view-rendered')).toBe('ok');
    expect(resized.style.height).toBe('520px');
    expect(resized.textContent).toContain('Dune');
    expect(instancesMock).not.toHaveBeenCalled();
  });
});
