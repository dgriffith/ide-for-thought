/**
 * @vitest-environment happy-dom
 *
 * Map layout for the Typed Objects multi-view (#2066). MapLibre GL is mocked
 * entirely — no real WebGL context, no real network fetch to OpenFreeMap —
 * so these tests exercise TypeViewMap.svelte's own logic: which instances get
 * a marker, click → open-note wiring, and cleanup on unmount.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';
import { flushSync, mount, unmount } from 'svelte';
import { reactiveProps } from '../../../src/renderer/lib/markdown/mounted-props.svelte';
import type { MapStyle } from '../../../src/shared/objects/map-style';

const { mapInstances, markerInstances, FakeMap, FakeMarker, FakeNavigationControl, FakeLngLatBounds } = vi.hoisted(() => {
  const mapInstances: InstanceType<typeof FakeMap>[] = [];
  const markerInstances: InstanceType<typeof FakeMarker>[] = [];

  class FakeLngLatBounds {
    private empty = true;
    extend(): this { this.empty = false; return this; }
    isEmpty(): boolean { return this.empty; }
  }
  class FakeMarker {
    el: HTMLElement;
    lngLat: [number, number] | null = null;
    opts: { color?: string; element?: HTMLElement; anchor?: string; offset?: [number, number] } | undefined;
    constructor(opts?: { color?: string; element?: HTMLElement; anchor?: string; offset?: [number, number] }) {
      this.opts = opts;
      // A custom element is the marker's own, as in MapLibre; else a stand-in
      // for the stock pin's wrapper.
      this.el = opts?.element ?? document.createElement('div');
    }
    setLngLat(ll: [number, number]): this { this.lngLat = ll; return this; }
    // In the map's container, as MapLibre puts it — focus needs it in the document (#2934).
    addTo(map?: { opts?: { container?: HTMLElement } }): this { markerInstances.push(this); map?.opts?.container?.appendChild(this.el); return this; }
    getElement(): HTMLElement { return this.el; }
    remove = vi.fn();
  }
  class FakeNavigationControl {}
  class FakeMap {
    opts: unknown;
    remove = vi.fn();
    canvas = document.createElement('canvas');
    constructor(opts: unknown) {
      this.opts = opts;
      mapInstances.push(this);
      // MapLibre's canvas is the map's tab stop (#2934): in the container, focusable.
      this.canvas.tabIndex = 0;
      (opts as { container?: HTMLElement }).container?.appendChild(this.canvas);
    }
    getCanvas(): HTMLCanvasElement { return this.canvas; }
    addControl(): void {}
    resize(): void {}
    fitBounds = vi.fn();
    setCenter = vi.fn();
    setZoom = vi.fn();
    setStyle = vi.fn();
    // The pins' keyboard (#2934): `inView` decides what `getBounds().contains` says.
    inView: (ll: [number, number]) => boolean = () => true;
    on = vi.fn();
    getBounds() { return { contains: (ll: [number, number]) => this.inView(ll) }; }
    easeTo = vi.fn();
    // The ⇧-drag box (#2939): drag-pan held off, and a pin's drawn point — 10px per degree.
    dragPan = { disable: vi.fn(), enable: vi.fn() };
    project(ll: [number, number]) { return { x: (ll[0] + 180) * 10, y: (90 - ll[1]) * 10 }; }
  }
  return { mapInstances, markerInstances, FakeMap, FakeMarker, FakeNavigationControl, FakeLngLatBounds };
});

vi.mock('../../../src/renderer/lib/map/load-maplibre', () => ({
  loadMapLibre: vi.fn().mockResolvedValue({
    Map: FakeMap,
    Marker: FakeMarker,
    NavigationControl: FakeNavigationControl,
    LngLatBounds: FakeLngLatBounds,
  }),
}));
vi.mock('../../../src/renderer/lib/map/maplibre-style', () => ({
  // The app theme is light here, so `auto` resolves to the light style.
  mapStyleUrl: (s: string) => (s === 'dark' ? 'https://tiles.openfreemap.org/styles/dark' : 'https://tiles.openfreemap.org/styles/liberty'),
  resolveMapStyle: (s: string) => (s === 'dark' ? 'dark' : 'light'),
  exportStyleUrl: () => 'https://tiles.openfreemap.org/styles/liberty',
}));

const { typeForNote } = vi.hoisted(() => ({ typeForNote: vi.fn() }));
vi.mock('../../../src/renderer/lib/stores/object-types.svelte', () => ({
  objectTypesStore: { typeForNote },
}));

import TypeViewMap from '../../../src/renderer/lib/components/TypeViewMap.svelte';

const INSTANCES = [
  { path: 'SF.md', title: 'San Francisco', values: { location: '37.7749,-122.4194' }, cover: null },
  { path: 'NoLocation.md', title: 'No Location', values: { location: null }, cover: null },
  { path: 'Malformed.md', title: 'Malformed', values: { location: 'not-a-coordinate' }, cover: null },
  { path: 'WrongCount.md', title: 'Wrong Count', values: { location: '1,2,3' }, cover: null },
  { path: 'NYC.md', title: 'New York', values: { location: '40.7128,-74.0060' }, cover: null },
];

beforeEach(() => {
  typeForNote.mockReturnValue(null);
});

afterEach(() => {
  cleanup();
  mapInstances.length = 0;
  markerInstances.length = 0;
  vi.clearAllMocks();
});

describe('TypeViewMap (#2066)', () => {
  it('creates one marker per instance with a valid geo value, skipping missing/malformed ones', async () => {
    render(TypeViewMap, { instances: INSTANCES, locationProperty: 'location', onOpenNote: vi.fn() });
    await waitFor(() => expect(markerInstances.length).toBe(2));
    expect(markerInstances.map((m) => m.lngLat)).toEqual([
      [-122.4194, 37.7749], // MapLibre order is [lng, lat]
      [-74.006, 40.7128],
    ]);
  });

  it('names each marker by its instance title, with no native title tooltip (#2710: the shared hover preview replaced it)', async () => {
    render(TypeViewMap, { instances: INSTANCES, locationProperty: 'location', onOpenNote: vi.fn() });
    await waitFor(() => expect(markerInstances.length).toBe(2));
    expect(markerInstances.map((m) => m.getElement().getAttribute('aria-label'))).toEqual(['San Francisco', 'New York']);
    expect(markerInstances.map((m) => m.getElement().title)).toEqual(['', '']);
  });

  it('clicking a marker opens its note', async () => {
    const onOpenNote = vi.fn();
    render(TypeViewMap, { instances: INSTANCES, locationProperty: 'location', onOpenNote });
    await waitFor(() => expect(markerInstances.length).toBe(2));

    await fireEvent.click(markerInstances[0]!.getElement());
    expect(onOpenNote).toHaveBeenCalledWith('SF.md');
    await fireEvent.click(markerInstances[1]!.getElement());
    expect(onOpenNote).toHaveBeenCalledWith('NYC.md');
  });

  it("right-clicking a pin hands its note to the view's menu, not the map's or the page's (#2930)", async () => {
    const onPinContextMenu = vi.fn();
    const outer = vi.fn();
    document.body.addEventListener('contextmenu', outer);
    render(TypeViewMap, { instances: INSTANCES, locationProperty: 'location', onOpenNote: vi.fn(), onPinContextMenu });
    await waitFor(() => expect(markerInstances.length).toBe(2));
    await fireEvent.contextMenu(markerInstances[1]!.getElement(), { clientX: 12, clientY: 34 });
    expect(onPinContextMenu).toHaveBeenCalledOnce();
    expect(onPinContextMenu.mock.calls[0]![1]).toBe('NYC.md');
    expect(outer).not.toHaveBeenCalled(); // a note's preview menu never hears it
    document.body.removeEventListener('contextmenu', outer);
  });

  it('with no menu handler a right-click on a pin is left alone', async () => {
    render(TypeViewMap, { instances: INSTANCES, locationProperty: 'location', onOpenNote: vi.fn() });
    await waitFor(() => expect(markerInstances.length).toBe(2));
    const ev = new MouseEvent('contextmenu', { bubbles: true, cancelable: true });
    markerInstances[0]!.getElement().dispatchEvent(ev);
    expect(ev.defaultPrevented).toBe(false);
  });

  it('removes the map and every marker on unmount', async () => {
    const { unmount } = render(TypeViewMap, { instances: INSTANCES, locationProperty: 'location', onOpenNote: vi.fn() });
    await waitFor(() => expect(markerInstances.length).toBe(2));

    const [marker1, marker2] = markerInstances;
    unmount();
    expect(mapInstances[0]!.remove).toHaveBeenCalledTimes(1);
    expect(marker1!.remove).toHaveBeenCalledTimes(1);
    expect(marker2!.remove).toHaveBeenCalledTimes(1);
  });

  it('picks up a new instance added while the map is already mounted (a prop change after mount, not just the initial load)', async () => {
    // The original #2066 implementation placed markers exactly once, inside
    // onMount's async IIFE — so a note added/typed after the map tab was
    // already open never got a pin, no matter how long you waited. Report:
    // a Place note added while viewing the Place map didn't show up.
    const { rerender } = render(TypeViewMap, {
      instances: [INSTANCES[0]!],
      locationProperty: 'location',
      onOpenNote: vi.fn(),
    });
    await waitFor(() => expect(markerInstances.length).toBe(1));
    const [firstMarker] = markerInstances;

    const pragueHotel = { path: 'W Prague.md', title: 'W Prague', values: { location: '50.0814,14.4249' }, cover: null };
    await rerender({
      instances: [INSTANCES[0]!, pragueHotel],
      locationProperty: 'location',
      onOpenNote: vi.fn(),
    });

    // Full resync: the old marker is torn down and every current instance is
    // rebuilt from scratch, so the total ever-created count is 1 (initial) + 2
    // (rebuild) = 3 — not a diff/patch, a wholesale rebuild off the new props.
    await waitFor(() => expect(markerInstances.length).toBe(3));
    expect(firstMarker!.remove).toHaveBeenCalledTimes(1);
    const rebuilt = markerInstances.slice(1);
    expect(rebuilt.map((m) => m.lngLat)).toEqual([
      [-122.4194, 37.7749], // San Francisco, still present
      [14.4249, 50.0814], // W Prague, the newly added instance
    ]);
  });

  it('colors each marker by the instance\'s own exact type, not one uniform color', async () => {
    // A "Place" map includes subclass instances (restaurant, hotel, …) —
    // each should get its own type's pin color, not the tab's.
    typeForNote.mockImplementation((path: string) => {
      if (path === 'SF.md') return { id: 'restaurant', label: 'Restaurant', color: '#f38ba8' };
      if (path === 'NYC.md') return { id: 'hotel', label: 'Hotel', color: '#89b4fa' };
      return null;
    });
    render(TypeViewMap, { instances: INSTANCES, locationProperty: 'location', onOpenNote: vi.fn() });
    await waitFor(() => expect(markerInstances.length).toBe(2));
    expect(markerInstances.map((m) => m.opts?.color)).toEqual(['#f38ba8', '#89b4fa']);
  });

  it('falls back to the default marker color when the instance\'s type has none', async () => {
    typeForNote.mockReturnValue({ id: 'place', label: 'Place' }); // no `color` field
    render(TypeViewMap, { instances: [INSTANCES[0]!], locationProperty: 'location', onOpenNote: vi.fn() });
    await waitFor(() => expect(markerInstances.length).toBe(1));
    expect(markerInstances[0]!.opts).toBeUndefined();
  });

  describe('type icon pins (#2711)', () => {
    const typed = (path: string) => {
      if (path === 'SF.md') return { id: 'restaurant', label: 'Restaurant', color: '#f38ba8', icon: '🍕' };
      if (path === 'NYC.md') return { id: 'hotel', label: 'Hotel', color: '#89b4fa' }; // no icon
      return null;
    };

    it('a typed instance\'s pin carries its type\'s emoji, in a teardrop of the type\'s colour', async () => {
      typeForNote.mockImplementation(typed);
      render(TypeViewMap, { instances: INSTANCES, locationProperty: 'location', onOpenNote: vi.fn() });
      await waitFor(() => expect(markerInstances.length).toBe(2));
      const pin = markerInstances[0]!;
      // A custom element, bottom-anchored and nudged so the tip is on the point.
      expect(pin.opts?.element).toBeInstanceOf(HTMLElement);
      expect(pin.opts?.anchor).toBe('bottom');
      expect(pin.opts?.offset?.[0]).toBe(0);
      expect(pin.opts?.offset?.[1]).toBeGreaterThan(0);
      const el = pin.getElement();
      expect(el.querySelector('text')?.textContent).toBe('🍕');
      expect(el.querySelector('svg g[fill="#f38ba8"] path')).toBeTruthy();
    });

    it('an icon-less type keeps the stock pin', async () => {
      typeForNote.mockImplementation(typed);
      render(TypeViewMap, { instances: INSTANCES, locationProperty: 'location', onOpenNote: vi.fn() });
      await waitFor(() => expect(markerInstances.length).toBe(2));
      expect(markerInstances[1]!.opts).toEqual({ color: '#89b4fa' });
      expect(markerInstances[1]!.getElement().querySelector('text')).toBeNull();
    });

    it('an icon with no type colour gets the stock pin\'s colour', async () => {
      typeForNote.mockReturnValue({ id: 'place', label: 'Place', icon: '📍' });
      render(TypeViewMap, { instances: [INSTANCES[0]!], locationProperty: 'location', onOpenNote: vi.fn() });
      await waitFor(() => expect(markerInstances.length).toBe(1));
      expect(markerInstances[0]!.getElement().querySelector('svg g[fill="#3FB1CE"] path')).toBeTruthy();
    });

    it('keeps click-to-open and pointer; named by the title, emoji decorative, no native tooltip (the shared hover, #2710)', async () => {
      typeForNote.mockImplementation(typed);
      const onOpenNote = vi.fn();
      render(TypeViewMap, { instances: INSTANCES, locationProperty: 'location', onOpenNote });
      await waitFor(() => expect(markerInstances.length).toBe(2));
      const el = markerInstances[0]!.getElement();
      expect(el.title).toBe(''); // the shared hover preview replaced the native tooltip (#2710)
      expect(el.style.cursor).toBe('pointer');
      expect(el.getAttribute('role')).toBe('button'); // a pin takes focus and acts (#2934), so not an image
      expect(el.getAttribute('aria-label')).toBe('San Francisco');
      expect(el.querySelector('text')!.getAttribute('aria-hidden')).toBe('true');
      await fireEvent.click(el.querySelector('text')!);
      expect(onOpenNote).toHaveBeenCalledWith('SF.md');
    });

    it('an icon is text, never markup — a type definition can come from a shared thoughtbase', async () => {
      typeForNote.mockReturnValue({ id: 'x', label: 'X', icon: '<img src=x onerror=alert(1)>' });
      render(TypeViewMap, { instances: [INSTANCES[0]!], locationProperty: 'location', onOpenNote: vi.fn() });
      await waitFor(() => expect(markerInstances.length).toBe(1));
      const el = markerInstances[0]!.getElement();
      expect(el.querySelector('img')).toBeNull();
      expect(el.querySelector('text')!.textContent).toBe('<img src=x onerror=alert(1)>');
    });
  });

  describe('map style (#2665)', () => {
    const LIGHT = 'https://tiles.openfreemap.org/styles/liberty';
    const DARK = 'https://tiles.openfreemap.org/styles/dark';
    const base = { instances: INSTANCES, locationProperty: 'location', onOpenNote: vi.fn() };

    it('builds the map in the view\'s explicit style', async () => {
      render(TypeViewMap, { ...base, mapStyle: 'dark' });
      await waitFor(() => expect(mapInstances.length).toBe(1));
      expect(mapInstances[0]!.opts).toMatchObject({ style: DARK });
    });

    /** Mounted the way the app mounts it: each prop its own reactive source,
     *  so changing `mapStyle` changes only `mapStyle`. (`rerender` replaces
     *  the whole props object, which re-fires every prop read.) */
    function mountReactive(mapStyle: MapStyle) {
      const target = document.body.appendChild(document.createElement('div'));
      const props = reactiveProps<{ instances: typeof INSTANCES; locationProperty: string; onOpenNote: () => void; mapStyle: MapStyle }>({ ...base, mapStyle });
      const instance = mount(TypeViewMap, { target, props });
      mounted.push(() => { void unmount(instance); target.remove(); });
      return { props, target };
    }
    const mounted: Array<() => void> = [];
    afterEach(() => { for (const off of mounted.splice(0)) off(); });

    it('switches live with setStyle, keeping every marker and the camera', async () => {
      const { props } = mountReactive('auto');
      await waitFor(() => expect(markerInstances.length).toBe(2));
      const map = mapInstances[0]!;
      expect(map.opts).toMatchObject({ style: LIGHT });
      const framed = map.fitBounds.mock.calls.length;

      flushSync(() => { props.mapStyle = 'dark'; });
      expect(map.setStyle).toHaveBeenCalledWith(DARK);
      expect(mapInstances).toHaveLength(1); // restyled in place, not rebuilt
      expect(markerInstances).toHaveLength(2); // no marker re-created…
      for (const m of markerInstances) expect(m.remove).not.toHaveBeenCalled(); // …or removed
      expect(map.fitBounds.mock.calls.length).toBe(framed); // the camera isn't re-framed

      flushSync(() => { props.mapStyle = 'light'; });
      expect(map.setStyle).toHaveBeenLastCalledWith(LIGHT);
      // `auto` on a light app is the light style already — no redundant swap.
      flushSync(() => { props.mapStyle = 'auto'; });
      expect(map.setStyle).toHaveBeenCalledTimes(2);
    });

    it('icon pins survive a live style switch too: same elements, emoji intact', async () => {
      typeForNote.mockReturnValue({ id: 'place', label: 'Place', color: '#f38ba8', icon: '📍' });
      const { props } = mountReactive('light');
      await waitFor(() => expect(markerInstances.length).toBe(2));
      const els = markerInstances.map((m) => m.getElement());
      flushSync(() => { props.mapStyle = 'dark'; });
      expect(mapInstances[0]!.setStyle).toHaveBeenCalledWith(DARK);
      expect(markerInstances).toHaveLength(2);
      for (const m of markerInstances) expect(m.remove).not.toHaveBeenCalled();
      expect(markerInstances.map((m) => m.getElement())).toEqual(els);
      for (const el of els) expect(el.querySelector('text')!.textContent).toBe('📍');
    });

    it('marks the tiles dark, so the pins get their light halo', () => {
      const { props, target } = mountReactive('light');
      expect(target.querySelector('.type-view-map-wrap.dark-tiles')).toBeNull();
      flushSync(() => { props.mapStyle = 'dark'; });
      expect(target.querySelector('.type-view-map-wrap.dark-tiles')).toBeTruthy();
    });

    it('the control is a labelled button group announcing the current style, operable by keyboard', async () => {
      const onMapStyleChange = vi.fn();
      render(TypeViewMap, { ...base, mapStyle: 'auto', onMapStyleChange });
      const group = await waitFor(() => {
        const g = document.querySelector('[role="group"][aria-label="Map style"]');
        expect(g).toBeTruthy();
        return g!;
      });
      const buttons = [...group.querySelectorAll('button')];
      expect(buttons.map((b) => [b.textContent, b.getAttribute('aria-pressed')])).toEqual([['Auto', 'true'], ['Light', 'false'], ['Dark', 'false']]);
      // Native <button>s: focusable, and Enter/Space activate them as a click.
      for (const b of buttons) expect(b.getAttribute('type')).toBe('button');
      buttons[2]!.focus();
      expect(document.activeElement).toBe(buttons[2]);
      await fireEvent.click(buttons[2]!);
      expect(onMapStyleChange).toHaveBeenCalledWith('dark');
      await fireEvent.click(buttons[0]!); // the current one is a no-op
      expect(onMapStyleChange).toHaveBeenCalledTimes(1);
    });

    it('shows no control without a handler (an embed)', async () => {
      render(TypeViewMap, { ...base, mapStyle: 'dark' });
      await waitFor(() => expect(mapInstances.length).toBe(1));
      expect(document.querySelector('[aria-label="Map style"]')).toBeNull();
    });
  });

  it('does not throw with zero located instances', async () => {
    render(TypeViewMap, {
      instances: [{ path: 'X.md', title: 'X', values: { location: null }, cover: null }],
      locationProperty: 'location',
      onOpenNote: vi.fn(),
    });
    await waitFor(() => expect(mapInstances.length).toBe(1));
    expect(markerInstances.length).toBe(0);
  });
});

describe('the pins from the keyboard (#2934)', () => {
  // Three located places: SF (west), Chicago (north), NYC (east).
  const THREE = [
    { path: 'SF.md', title: 'San Francisco', values: { location: '37.7749,-122.4194' }, cover: null },
    { path: 'CHI.md', title: 'Chicago', values: { location: '41.8781,-87.6298' }, cover: null },
    { path: 'NYC.md', title: 'New York', values: { location: '40.7128,-74.0060' }, cover: null },
  ];
  const pin = (title: string) => markerInstances.find((m) => m.getElement().getAttribute('aria-label') === title)!.getElement();
  const tabbable = () => markerInstances.filter((m) => m.getElement().tabIndex === 0).map((m) => m.getElement().getAttribute('aria-label'));
  async function mounted(over: Record<string, unknown> = {}) {
    const utils = render(TypeViewMap, { instances: THREE, locationProperty: 'location', onOpenNote: vi.fn(), type: { id: 'place', label: 'Place' } as never, ...over });
    await waitFor(() => expect(markerInstances.length).toBe(3));
    return utils;
  }

  it('the pins are buttons and ONE tab stop — the first in view, after the map, which is named for its places', async () => {
    render(TypeViewMap, { instances: THREE, locationProperty: 'location', onOpenNote: vi.fn(), type: { id: 'place', label: 'Place' } as never });
    await waitFor(() => expect(markerInstances.length).toBe(3));
    await waitFor(() => expect(mapInstances[0]!.canvas.getAttribute('aria-label')).toBe('Place map, 3 places'));
    expect(markerInstances.every((m) => m.getElement().getAttribute('role') === 'button')).toBe(true);
    expect(tabbable()).toEqual(['San Francisco']); // the first going west → east
    cleanup();
    markerInstances.length = 0;
    mapInstances.length = 0;
    // San Francisco out of view: the stop is the first pin that is in view.
    const real = FakeMap.prototype.getBounds;
    FakeMap.prototype.getBounds = function () { return { contains: (ll: [number, number]) => ll[0] > -100 }; };
    try {
      await mounted();
      expect(tabbable()).toEqual(['Chicago']);
    } finally { FakeMap.prototype.getBounds = real; }
  });

  it('←/→ step west → east, ↑/↓ north → south, Home/End to the ends; the stop follows focus', async () => {
    await mounted();
    pin('San Francisco').focus();
    await fireEvent.keyDown(pin('San Francisco'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(pin('Chicago'));
    await fireEvent.keyDown(pin('Chicago'), { key: 'ArrowDown' });
    expect(document.activeElement).toBe(pin('New York'));
    await fireEvent.keyDown(pin('New York'), { key: 'ArrowUp' });
    expect(document.activeElement).toBe(pin('Chicago'));
    await fireEvent.keyDown(pin('Chicago'), { key: 'Home' });
    expect(document.activeElement).toBe(pin('San Francisco'));
    await fireEvent.keyDown(pin('San Francisco'), { key: 'End' });
    expect(document.activeElement).toBe(pin('New York'));
    expect(tabbable()).toEqual(['New York']);
  });

  it("a pin's keys stay with it: MapLibre's handler on the map never sees them", async () => {
    const { container } = await mounted();
    const seen = vi.fn();
    container.querySelector('.type-view-map')!.addEventListener('keydown', seen);
    pin('Chicago').focus();
    const e = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    pin('Chicago').dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(seen).not.toHaveBeenCalled();
  });

  it('Enter opens the note; Shift+F10 / the menu key opens its note menu', async () => {
    const onOpenNote = vi.fn();
    const onPinContextMenu = vi.fn();
    await mounted({ onOpenNote, onPinContextMenu });
    pin('Chicago').focus();
    await fireEvent.keyDown(pin('Chicago'), { key: 'Enter' });
    expect(onOpenNote).toHaveBeenCalledWith('CHI.md');
    await fireEvent.keyDown(pin('Chicago'), { key: 'F10', shiftKey: true });
    await fireEvent.keyDown(pin('Chicago'), { key: 'ContextMenu' });
    expect(onPinContextMenu.mock.calls.map((c) => c[1])).toEqual(['CHI.md', 'CHI.md']);
  });

  it('focus shows the preview; Escape closes it, and again goes back to the map', async () => {
    await mounted();
    pin('Chicago').focus();
    await waitFor(() => expect(pin('Chicago').getAttribute('aria-describedby')).toBeTruthy());
    await fireEvent.keyDown(pin('Chicago'), { key: 'Escape' });
    await waitFor(() => expect(pin('Chicago').hasAttribute('aria-describedby')).toBe(false));
    expect(document.activeElement).toBe(pin('Chicago'));
    await fireEvent.keyDown(pin('Chicago'), { key: 'Escape' });
    expect(document.activeElement).toBe(mapInstances[0]!.canvas);
  });

  it('an export takes no tab stops and no keys', async () => {
    await mounted({ exportHooks: { onCaptured: vi.fn() } });
    for (const m of markerInstances) {
      expect(m.getElement().hasAttribute('tabindex')).toBe(false);
      expect(m.getElement().getAttribute('role')).not.toBe('button');
    }
  });

  it('focusing a pin out of view eases the map to it, at the same zoom', async () => {
    await mounted();
    const map = mapInstances[0]!;
    map.inView = (ll) => ll[0] !== -74.006;
    pin('Chicago').focus();
    expect(map.easeTo).not.toHaveBeenCalled();
    pin('New York').focus();
    expect(map.easeTo).toHaveBeenCalledWith({ center: [-74.006, 40.7128] });
  });
});

describe('selecting several pins (#2939)', () => {
  // Projected (10px a degree): SF ≈ (575, 522), Chicago ≈ (924, 481), NYC ≈ (1060, 493).
  const THREE = [
    { path: 'SF.md', title: 'San Francisco', values: { location: '37.7749,-122.4194' }, cover: null },
    { path: 'CHI.md', title: 'Chicago', values: { location: '41.8781,-87.6298' }, cover: null },
    { path: 'NYC.md', title: 'New York', values: { location: '40.7128,-74.0060' }, cover: null },
  ];
  const pin = (title: string) => markerInstances.find((m) => m.getElement().getAttribute('aria-label') === title)!.getElement();
  async function mounted(over: Record<string, unknown> = {}) {
    const utils = render(TypeViewMap, { instances: THREE, locationProperty: 'location', onOpenNote: vi.fn(), ...over });
    await waitFor(() => expect(markerInstances.length).toBe(3));
    return utils;
  }
  const drag = async (from: { x: number; y: number }, to: { x: number; y: number }, mods: Record<string, boolean> = {}) => {
    const map = document.querySelector<HTMLElement>('.type-view-map')!;
    await fireEvent.pointerDown(map, { button: 0, pointerId: 1, clientX: from.x, clientY: from.y, shiftKey: true });
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: to.x, clientY: to.y });
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: to.x, clientY: to.y, ...mods });
  };

  it('a click goes to the view with its modifiers where it selects; Space toggles the focused pin', async () => {
    const onPinClick = vi.fn();
    const onOpenNote = vi.fn();
    await mounted({ onPinClick, onOpenNote });
    await fireEvent.click(pin('Chicago'), { metaKey: true });
    expect(onPinClick).toHaveBeenCalledWith(expect.objectContaining({ metaKey: true }), 'CHI.md');
    expect(onOpenNote).not.toHaveBeenCalled();
    pin('New York').focus();
    await fireEvent.keyDown(pin('New York'), { key: ' ' });
    expect(onPinClick).toHaveBeenLastCalledWith(expect.objectContaining({ metaKey: true }), 'NYC.md');
  });

  it('draws the selection: a ring, and aria-pressed on every pin', async () => {
    await mounted({ onPinClick: vi.fn(), isSelected: (p: string) => p === 'CHI.md' });
    expect(pin('Chicago').classList.contains('pin-selected')).toBe(true);
    expect(pin('Chicago').getAttribute('aria-pressed')).toBe('true');
    expect(pin('New York').getAttribute('aria-pressed')).toBe('false');
  });

  it('⇧-drag draws a box and selects the pins inside it, with drag-pan held off; MapLibre\'s box zoom is off', async () => {
    const onBoxSelect = vi.fn();
    await mounted({ onPinClick: vi.fn(), onBoxSelect });
    const map = mapInstances[0]!;
    expect(map.opts).toMatchObject({ boxZoom: false });
    const surface = document.querySelector<HTMLElement>('.type-view-map')!;
    await fireEvent.pointerDown(surface, { button: 0, pointerId: 1, clientX: 900, clientY: 450, shiftKey: true });
    expect(map.dragPan.disable).toHaveBeenCalled();
    await fireEvent.pointerMove(window, { pointerId: 1, clientX: 1100, clientY: 520 });
    expect(surface.querySelector('.map-select-box')).not.toBeNull();
    await fireEvent.pointerUp(window, { pointerId: 1, clientX: 1100, clientY: 520 });
    expect(onBoxSelect).toHaveBeenCalledWith(['CHI.md', 'NYC.md'], false);
    expect(map.dragPan.enable).toHaveBeenCalled();
    expect(surface.querySelector('.map-select-box')).toBeNull();
    await drag({ x: 500, y: 450 }, { x: 600, y: 600 }, { metaKey: true });
    expect(onBoxSelect).toHaveBeenLastCalledWith(['SF.md'], true); // with ⌘: toggle
  });

  it('a ⇧-click on empty map, or a drag without ⇧, selects nothing; where the view doesn\'t select, no box', async () => {
    const onBoxSelect = vi.fn();
    await mounted({ onPinClick: vi.fn(), onBoxSelect });
    await drag({ x: 900, y: 450 }, { x: 901, y: 451 });
    const surface = document.querySelector<HTMLElement>('.type-view-map')!;
    await fireEvent.pointerDown(surface, { button: 0, pointerId: 2, clientX: 900, clientY: 450 });
    await fireEvent.pointerUp(window, { pointerId: 2, clientX: 1100, clientY: 520 });
    expect(onBoxSelect).not.toHaveBeenCalled();
    cleanup();
    markerInstances.length = 0;
    mapInstances.length = 0;
    await mounted();
    expect(mapInstances[0]!.opts).not.toHaveProperty('boxZoom');
  });
});
