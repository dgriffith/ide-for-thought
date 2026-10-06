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
    el = document.createElement('div');
    lngLat: [number, number] | null = null;
    opts: { color?: string } | undefined;
    constructor(opts?: { color?: string }) { this.opts = opts; }
    setLngLat(ll: [number, number]): this { this.lngLat = ll; return this; }
    addTo(): this { markerInstances.push(this); return this; }
    getElement(): HTMLElement { return this.el; }
    remove = vi.fn();
  }
  class FakeNavigationControl {}
  class FakeMap {
    opts: unknown;
    remove = vi.fn();
    constructor(opts: unknown) { this.opts = opts; mapInstances.push(this); }
    addControl(): void {}
    resize(): void {}
    fitBounds = vi.fn();
    setCenter = vi.fn();
    setZoom = vi.fn();
    setStyle = vi.fn();
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

  it('sets each marker\'s native title attribute to the instance title, for a hover tooltip', async () => {
    render(TypeViewMap, { instances: INSTANCES, locationProperty: 'location', onOpenNote: vi.fn() });
    await waitFor(() => expect(markerInstances.length).toBe(2));
    expect(markerInstances.map((m) => m.getElement().title)).toEqual(['San Francisco', 'New York']);
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
