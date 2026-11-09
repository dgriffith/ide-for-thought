/**
 * @vitest-environment happy-dom
 *
 * The note menu on a map pin (#2930): right-click a pin and the view's
 * note-actions menu opens for THAT pin's note — in the panel and in an embed —
 * instead of falling through to the map, or to a note preview's page menu
 * around an embed. MapLibre is a fake (as in TypeViewMap.test.ts), so the
 * pins are plain elements the test can right-click.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const h = vi.hoisted(() => {
  const pins: HTMLElement[] = [];
  class FakeLngLatBounds {
    extend(): this { return this; }
    isEmpty(): boolean { return false; }
  }
  class FakeMarker {
    el: HTMLElement;
    constructor(opts?: { element?: HTMLElement }) { this.el = opts?.element ?? document.createElement('div'); }
    setLngLat(): this { return this; }
    addTo(map?: { opts?: { container?: HTMLElement } }): this { pins.push(this.el); map?.opts?.container?.appendChild(this.el); return this; }
    getElement(): HTMLElement { return this.el; }
    // Gone from the map and the list, as MapLibre's marker is when the pins are rebuilt.
    remove(): void { this.el.remove(); const i = pins.indexOf(this.el); if (i !== -1) pins.splice(i, 1); }
  }
  class FakeMap {
    opts: { container?: HTMLElement };
    // The pins and canvas sit in the container, as MapLibre's do, so focus and the box work (#2939).
    constructor(opts: { container?: HTMLElement }) { this.opts = opts; }
    dragPan = { disable(): void {}, enable(): void {} };
    project(ll: [number, number]) { return { x: (ll[0] + 180) * 10, y: (90 - ll[1]) * 10 }; }
    addControl(): void {}
    resize(): void {}
    fitBounds(): void {}
    setCenter(): void {}
    setZoom(): void {}
    setStyle(): void {}
    // The pins' keyboard (#2934): what's in view, easing to a pin, and the map's moves.
    on(): void {}
    getBounds(): { contains: () => boolean } { return { contains: () => true }; }
    easeTo(): void {}
    getCanvas(): HTMLCanvasElement { return document.createElement('canvas'); }
    remove(): void {}
  }
  return {
    pins, instances: vi.fn(), list: vi.fn(), noteTypeMap: vi.fn(),
    maplibre: { Map: FakeMap, Marker: FakeMarker, NavigationControl: class {}, LngLatBounds: FakeLngLatBounds },
  };
});
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: h.instances, list: h.list, noteTypeMap: h.noteTypeMap }, app: { getSystemLocale: async () => 'en-GB' } },
}));
vi.mock('../../../src/renderer/lib/map/load-maplibre', () => ({ loadMapLibre: vi.fn(async () => h.maplibre) }));

import TypeView from '../../../src/renderer/lib/components/TypeView.svelte';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';

const PLACE = {
  id: 'place', label: 'Place', classLocalName: 'Place', icon: '📍', source: 'stock' as const,
  properties: [{ name: 'location', type: 'geo' as const, label: 'Location' }],
};
const PLACES = [
  { path: 'SF.md', title: 'San Francisco', values: { location: '37.7749,-122.4194' }, cover: null },
  { path: 'NYC.md', title: 'New York', values: { location: '40.7128,-74.0060' }, cover: null },
];
const actions = () => ({ editProperties: vi.fn(), addTag: vi.fn(), removeTag: vi.fn(), clearProperty: vi.fn() });
const props = (over: Record<string, unknown> = {}) => ({
  typeId: 'place', layout: 'map' as const, sortColumn: null, sortDir: 'asc' as const, columns: null,
  revision: 0, onStateChange: vi.fn(), onOpenNote: vi.fn(), ...over,
});
const pin = (title: string) => h.pins.find((p) => p.getAttribute('aria-label') === title)!;

beforeEach(async () => {
  h.pins.length = 0;
  h.instances.mockResolvedValue({ type: PLACE, instances: PLACES });
  h.list.mockResolvedValue({ types: [PLACE], errors: [] });
  h.noteTypeMap.mockResolvedValue({});
  await objectTypesStore.refresh();
});
afterEach(() => cleanup());

describe('the note menu on a map pin (#2930)', () => {
  it("in the panel: the note actions for that pin's note", async () => {
    const noteActions = actions();
    render(TypeView, props({ noteActions }));
    await waitFor(() => expect(h.pins).toHaveLength(2));
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 50 });
    pin('New York').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(true);
    await screen.findByRole('menu');
    await fireEvent.click(screen.getByRole('menuitem', { name: 'Add Tag…' }));
    expect(noteActions.addTag).toHaveBeenCalledWith(['NYC.md']);
  });

  it('in an embed: the same menu, and the right-click goes no further (not the note around it)', async () => {
    const noteActions = actions();
    const around = vi.fn();
    document.body.addEventListener('contextmenu', around);
    try {
      render(TypeView, props({ noteActions, chromeless: true }));
      await waitFor(() => expect(h.pins).toHaveLength(2));
      await fireEvent.contextMenu(pin('San Francisco'));
      await screen.findByRole('menu');
      expect(around).not.toHaveBeenCalled();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Edit Properties…' }));
      expect(noteActions.editProperties).toHaveBeenCalledWith(['SF.md']);
    } finally {
      document.body.removeEventListener('contextmenu', around);
    }
  });

  it('without note actions a right-click on a pin opens nothing and is left alone', async () => {
    render(TypeView, props());
    await waitFor(() => expect(h.pins).toHaveLength(2));
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    pin('New York').dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
    expect(screen.queryByRole('menu')).toBeNull();
  });
});

describe('several pins (#2939)', () => {
  // Projected at 10px a degree: SF ≈ (575, 522), Chicago ≈ (924, 481), NYC ≈ (1060, 493), Miami ≈ (998, 642).
  const FOUR = [
    ...PLACES,
    { path: 'CHI.md', title: 'Chicago', values: { location: '41.8781,-87.6298' }, cover: null },
    { path: 'MIA.md', title: 'Miami', values: { location: '25.7617,-80.1918' }, cover: null },
  ];
  beforeEach(() => { h.instances.mockResolvedValue({ type: PLACE, instances: FOUR }); });
  const pressed = () => h.pins.filter((p) => p.getAttribute('aria-pressed') === 'true').map((p) => p.getAttribute('aria-label'));

  it('a ⇧-drag box around three pins, then Add Tag… on one of them, reaches all three', async () => {
    const noteActions = actions();
    render(TypeView, props({ noteActions }));
    await waitFor(() => expect(h.pins).toHaveLength(4));
    const surface = document.querySelector<HTMLElement>('.type-view-map')!;
    await fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 500, clientY: 400, shiftKey: true });
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 1100, clientY: 560 });
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 1100, clientY: 560 });
    await waitFor(() => expect(pressed()).toEqual(['San Francisco', 'New York', 'Chicago']));
    await fireEvent.contextMenu(pin('Chicago'));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Add Tag… (3 notes)' }));
    expect(noteActions.addTag).toHaveBeenCalledWith(['SF.md', 'NYC.md', 'CHI.md']);
  });

  it('⌘-click and ⇧-click toggle a pin; an unselected pin\'s menu is its own; ⌘A selects every pin, Esc clears', async () => {
    const noteActions = actions();
    const onOpenNote = vi.fn();
    render(TypeView, props({ noteActions, onOpenNote }));
    await waitFor(() => expect(h.pins).toHaveLength(4));
    await fireEvent.click(pin('Chicago'), { metaKey: true });
    await fireEvent.click(pin('Miami'), { shiftKey: true }); // no range on a map: a toggle
    await waitFor(() => expect(pressed()).toEqual(['Chicago', 'Miami']));
    await fireEvent.click(pin('Miami'), { shiftKey: true });
    await waitFor(() => expect(pressed()).toEqual(['Chicago']));
    expect(onOpenNote).not.toHaveBeenCalled();
    await fireEvent.contextMenu(pin('New York'));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Add Tag…' }));
    expect(noteActions.addTag).toHaveBeenCalledWith(['NYC.md']);
    pin('Chicago').focus();
    await fireEvent.keyDown(pin('Chicago'), { key: 'a', metaKey: true });
    await waitFor(() => expect(pressed()).toHaveLength(4));
    await fireEvent.keyDown(pin('Chicago'), { key: 'Escape' });
    await waitFor(() => expect(pressed()).toEqual([]));
  });

  it('selecting redraws the pins it changes, not the map: a focused pin keeps focus through Space', async () => {
    render(TypeView, props({ noteActions: actions() }));
    await waitFor(() => expect(h.pins).toHaveLength(4));
    const chicago = pin('Chicago');
    chicago.focus();
    await fireEvent.keyDown(chicago, { key: ' ' });
    await waitFor(() => expect(pressed()).toEqual(['Chicago']));
    expect(pin('Chicago')).toBe(chicago); // the same element, not a rebuilt one
    expect(document.activeElement).toBe(chicago);
  });

  it('an embed selects too (#2940): ⌘-click toggles without opening, and the menu acts on the selection', async () => {
    const noteActions = actions();
    const onOpenNote = vi.fn();
    render(TypeView, props({ noteActions, chromeless: true, onOpenNote }));
    await waitFor(() => expect(h.pins).toHaveLength(4));
    await fireEvent.click(pin('Chicago'), { metaKey: true });
    await fireEvent.click(pin('Miami'), { metaKey: true });
    await waitFor(() => expect(pressed()).toEqual(['Chicago', 'Miami']));
    expect(onOpenNote).not.toHaveBeenCalled();
    await fireEvent.contextMenu(pin('Miami'));
    await fireEvent.click(await screen.findByRole('menuitem', { name: 'Add Tag… (2 notes)' }));
    expect(noteActions.addTag).toHaveBeenCalledWith(['CHI.md', 'MIA.md']);
  });
});
