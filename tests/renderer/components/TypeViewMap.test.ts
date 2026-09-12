/**
 * @vitest-environment happy-dom
 *
 * Map layout for the Typed Objects multi-view (#2066). MapLibre GL is mocked
 * entirely — no real WebGL context, no real network fetch to OpenFreeMap —
 * so these tests exercise TypeViewMap.svelte's own logic: which instances get
 * a marker, click → open-note wiring, and cleanup on unmount.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';

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
    fitBounds(): void {}
    setCenter(): void {}
    setZoom(): void {}
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
  styleUrlForTheme: () => 'https://tiles.openfreemap.org/styles/liberty',
}));

import TypeViewMap from '../../../src/renderer/lib/components/TypeViewMap.svelte';

const INSTANCES = [
  { path: 'SF.md', title: 'San Francisco', values: { location: '37.7749,-122.4194' }, cover: null },
  { path: 'NoLocation.md', title: 'No Location', values: { location: null }, cover: null },
  { path: 'Malformed.md', title: 'Malformed', values: { location: 'not-a-coordinate' }, cover: null },
  { path: 'WrongCount.md', title: 'Wrong Count', values: { location: '1,2,3' }, cover: null },
  { path: 'NYC.md', title: 'New York', values: { location: '40.7128,-74.0060' }, cover: null },
];

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
