/**
 * @vitest-environment happy-dom
 *
 * TypeViewMap in export mode (#2511): the preview's own map, rendered once in
 * the light style with no controls, captured only once it's idle with its
 * pins placed — or handing back the places when it can't be drawn.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => {
  const maps: Array<InstanceType<typeof FakeMap>> = [];
  class FakeLngLatBounds {
    private empty = true;
    extend(): this { this.empty = false; return this; }
    isEmpty(): boolean { return this.empty; }
  }
  class FakeMarker {
    el = document.createElement('div');
    ll: [number, number] = [0, 0];
    setLngLat(ll: [number, number]): this { this.ll = ll; return this; }
    getLngLat() { return { lng: this.ll[0], lat: this.ll[1] }; }
    addTo(): this { return this; }
    getElement(): HTMLElement { return this.el; }
    remove() {}
  }
  class FakeMap {
    opts: Record<string, unknown>;
    handlers: Record<string, Array<(e?: unknown) => void>> = {};
    controls = 0;
    constructor(opts: Record<string, unknown>) { this.opts = opts; maps.push(this); }
    on(evt: string, fn: (e?: unknown) => void): this { (this.handlers[evt] ??= []).push(fn); return this; }
    emit(evt: string, e?: unknown): void { for (const fn of this.handlers[evt] ?? []) fn(e); }
    addControl(): void { this.controls++; }
    resize(): void {}
    fitBounds(): void {}
    setCenter(): void {}
    setZoom(): void {}
    remove(): void {}
    project(ll: { lng: number; lat: number }) { return { x: ll.lng, y: ll.lat }; }
    getCanvas() { return document.createElement('canvas'); }
    getContainer() { const d = document.createElement('div'); d.getBoundingClientRect = () => ({ width: 760, height: 360 }) as DOMRect; return d; }
    getStyle() { return { sources: { omt: { url: 'https://tiles.example/planet' }, inline: { attribution: '© Inline' } } }; }
    // A TileJSON-backed source carries its credit only once loaded.
    getSource(id: string) { return id === 'omt' ? { attribution: '© <a href="#">OpenStreetMap</a> contributors' } : {}; }
  }
  return { maps, FakeMap, FakeMarker, FakeLngLatBounds, composite: vi.fn() };
});

vi.mock('../../../src/renderer/lib/map/load-maplibre', () => ({
  loadMapLibre: vi.fn().mockResolvedValue({ Map: h.FakeMap, Marker: h.FakeMarker, NavigationControl: class {}, LngLatBounds: h.FakeLngLatBounds }),
}));
vi.mock('../../../src/renderer/lib/map/maplibre-style', () => ({
  mapStyleUrl: () => 'https://tiles.example/dark', // the app is dark
  resolveMapStyle: () => 'dark',
  exportStyleUrl: (s: string = 'auto') => (s === 'dark' ? 'https://tiles.example/dark' : 'https://tiles.example/light'),
}));
vi.mock('../../../src/renderer/lib/stores/object-types.svelte', () => ({ objectTypesStore: { typeForNote: () => null } }));
vi.mock('../../../src/renderer/lib/map/map-export', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../../src/renderer/lib/map/map-export')>()),
  compositeMap: h.composite,
}));

import TypeViewMap from '../../../src/renderer/lib/components/TypeViewMap.svelte';
import { MAP_EXPORT_ERROR_GRACE_MS, MAP_EXPORT_TIMEOUT_MS, MAP_TILES_FAILED, type MapCapture } from '../../../src/renderer/lib/map/map-export';

const INSTANCES = [
  { path: 'trip/Kampa.md', title: 'Kampa Museum', values: { location: '50.0835,14.4089' }, cover: null },
  { path: 'trip/Nowhere.md', title: 'Nowhere', values: { location: null }, cover: null },
];

async function mountForExport(extra: { mapStyle?: 'auto' | 'light' | 'dark'; onMapStyleChange?: () => void } = {}) {
  const captures: MapCapture[] = [];
  render(TypeViewMap, { instances: INSTANCES, locationProperty: 'location', onOpenNote: vi.fn(), exportHooks: { onCaptured: (c) => captures.push(c) }, ...extra });
  await waitFor(() => expect(h.maps).toHaveLength(1));
  await new Promise((r) => setTimeout(r, 0)); // markers placed by the effect
  return { map: h.maps[0]!, captures };
}

beforeEach(() => { h.maps.length = 0; h.composite.mockReset().mockResolvedValue('data:image/png;base64,PNG'); });
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe('TypeViewMap export mode (#2511)', () => {
  it('renders light, still, with no controls, and a readable buffer', async () => {
    const { map } = await mountForExport();
    expect(map.opts).toMatchObject({ style: 'https://tiles.example/light', interactive: false, attributionControl: false, fadeDuration: 0, canvasContextAttributes: { preserveDrawingBuffer: true } });
    expect(map.controls).toBe(0);
  });

  it('an explicit dark style exports dark; light and auto export light (#2665)', async () => {
    const { map, captures } = await mountForExport({ mapStyle: 'dark', onMapStyleChange: vi.fn() });
    expect(map.opts).toMatchObject({ style: 'https://tiles.example/dark', interactive: false });
    expect(document.querySelector('[aria-label="Map style"]')).toBeNull(); // never a control in an export
    map.emit('idle');
    await waitFor(() => expect(captures).toHaveLength(1));
    expect(captures[0]).toMatchObject({ ok: true, attribution: '© OpenStreetMap contributors · © Inline' });
    cleanup();
    for (const mapStyle of ['light', 'auto'] as const) {
      h.maps.length = 0;
      const { map: m } = await mountForExport({ mapStyle });
      expect(m.opts).toMatchObject({ style: 'https://tiles.example/light' });
      cleanup();
    }
  });

  it('captures once idle: the composited image, the credit, and the located places', async () => {
    const { map, captures } = await mountForExport();
    map.emit('idle');
    await waitFor(() => expect(captures).toHaveLength(1));
    expect(captures[0]).toEqual({
      ok: true, image: 'data:image/png;base64,PNG', width: 760, height: 360,
      attribution: '© OpenStreetMap contributors · © Inline', // the loaded source's credit, and the style's
      places: [{ path: 'trip/Kampa.md', title: 'Kampa Museum', lat: 50.0835, lng: 14.4089 }],
    });
    // One pin, drawn at its projected point.
    expect(h.composite.mock.calls[0]![1]).toEqual([expect.objectContaining({ point: { x: 14.4089, y: 50.0835 } })]);
    map.emit('idle'); // later idles change nothing
    await new Promise((r) => setTimeout(r, 0));
    expect(captures).toHaveLength(1);
  });

  it('never publishes a half-drawn map: a tile error before idle hands back the places', async () => {
    const { map, captures } = await mountForExport();
    map.emit('error', { error: { message: 'Failed to fetch' } });
    map.emit('idle');
    await waitFor(() => expect(captures).toHaveLength(1));
    expect(captures[0]).toMatchObject({ ok: false, reason: MAP_TILES_FAILED, places: [{ title: 'Kampa Museum' }] });
    expect(h.composite).not.toHaveBeenCalled();
  });

  it('falls back quickly after a tile error even if the map never goes idle (offline)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { map, captures } = await mountForExport();
    map.emit('error', { error: { message: 'AJAXError: Failed to fetch (0)' } });
    await vi.advanceTimersByTimeAsync(MAP_EXPORT_ERROR_GRACE_MS);
    expect(captures).toEqual([expect.objectContaining({ ok: false, reason: MAP_TILES_FAILED })]);
  });

  it('gives up on a map that never goes idle', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const { captures } = await mountForExport();
    await vi.advanceTimersByTimeAsync(MAP_EXPORT_TIMEOUT_MS);
    expect(captures[0]).toMatchObject({ ok: false, reason: 'the map tiles took too long to load' });
  });

  it('a failure while composing becomes the fallback, not a lost block', async () => {
    h.composite.mockRejectedValue(new Error('a map pin could not be drawn'));
    const { map, captures } = await mountForExport();
    map.emit('idle');
    await waitFor(() => expect(captures).toHaveLength(1));
    expect(captures[0]).toMatchObject({ ok: false, reason: 'a map pin could not be drawn' });
  });
});
