/**
 * @vitest-environment happy-dom
 *
 * TypeViewMap on a machine with no WebGL2 (#3011). MapLibre throws from its
 * constructor there — the e2e run on CI's GPU-less Linux runner found it —
 * and nothing caught it: the live view was an empty box and an export's map
 * block never settled, so its places fallback (#2511) never ran. Now the view
 * lists the places with one line saying why, and an export gets them at once.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, cleanup, waitFor, fireEvent, screen } from '@testing-library/svelte';

const h = vi.hoisted(() => {
  const constructed: unknown[] = [];
  class GPUInitializationError extends Error {
    constructor() {
      super('WebGL2 is required to display this map. We are sorry, but it seems that your browser does not support WebGL2, a technology for rendering 3D graphics on the web.');
      this.name = 'GPUInitializationError';
    }
  }
  class ThrowingMap {
    constructor(opts: unknown) { constructed.push(opts); throw new GPUInitializationError(); }
  }
  class FakeLngLatBounds { extend(): this { return this; } isEmpty(): boolean { return true; } }
  return { constructed, ThrowingMap, FakeLngLatBounds };
});

vi.mock('../../../src/renderer/lib/map/load-maplibre', () => ({
  loadMapLibre: vi.fn().mockResolvedValue({ Map: h.ThrowingMap, Marker: class {}, NavigationControl: class {}, LngLatBounds: h.FakeLngLatBounds }),
}));
vi.mock('../../../src/renderer/lib/map/maplibre-style', () => ({
  mapStyleUrl: () => 'https://tiles.example/light',
  resolveMapStyle: () => 'light',
  exportStyleUrl: () => 'https://tiles.example/light',
}));
vi.mock('../../../src/renderer/lib/stores/object-types.svelte', () => ({ objectTypesStore: { typeForNote: () => null } }));

import TypeViewMap from '../../../src/renderer/lib/components/TypeViewMap.svelte';
import { MAP_NO_WEBGL, mapUnavailableReason, type MapCapture } from '../../../src/renderer/lib/map/map-export';

const INSTANCES = [
  { path: 'trip/Kampa.md', title: 'Kampa Museum', values: { location: '50.0835,14.4089' }, cover: null },
  { path: 'trip/Nowhere.md', title: 'Nowhere', values: { location: null }, cover: null },
  { path: 'trip/Letna.md', title: 'Letná Park', values: { location: '50.0970,14.4240' }, cover: null },
];

afterEach(() => { cleanup(); h.constructed.length = 0; });

describe('TypeViewMap with no WebGL2 (#3011)', () => {
  it('lists the located places with one line saying why, and no map or style switch', async () => {
    const { container } = render(TypeViewMap, { instances: INSTANCES, locationProperty: 'location', onOpenNote: vi.fn(), onMapStyleChange: vi.fn() });
    await waitFor(() => expect(container.querySelector('.map-unavailable')).not.toBeNull());
    expect(h.constructed).toHaveLength(1);
    expect(container.querySelector('.map-unavailable-note')?.textContent).toBe(`No map: ${MAP_NO_WEBGL}. Its places are listed instead.`);
    const rows = screen.getAllByRole('button', { name: /Kampa|Letná|Nowhere/ });
    expect(rows.map((r) => r.querySelector('.map-place-title')?.textContent)).toEqual(['Kampa Museum', 'Letná Park']);
    expect(rows[0]!.querySelector('.map-place-coords')?.textContent).toBe('50.0835, 14.4089');
    expect(container.querySelector('.type-view-map')).toBeNull();
    expect(container.querySelector('[aria-label="Map style"]')).toBeNull();
  });

  it('a row opens its note and takes the pin\'s right-click menu', async () => {
    const onOpenNote = vi.fn();
    const onPinContextMenu = vi.fn();
    render(TypeViewMap, { instances: INSTANCES, locationProperty: 'location', onOpenNote, onPinContextMenu });
    const row = await screen.findByRole('button', { name: /Letná Park/ });
    await fireEvent.click(row);
    expect(onOpenNote).toHaveBeenCalledWith('trip/Letna.md');
    await fireEvent.contextMenu(row);
    expect(onPinContextMenu).toHaveBeenCalledWith(expect.any(MouseEvent), 'trip/Letna.md');
  });

  it('says so without a list when nothing is located', async () => {
    const { container } = render(TypeViewMap, { instances: [INSTANCES[1]!], locationProperty: 'location', onOpenNote: vi.fn() });
    await waitFor(() => expect(container.querySelector('.map-unavailable-note')?.textContent).toBe(`No map: ${MAP_NO_WEBGL}.`));
    expect(container.querySelector('.map-places')).toBeNull();
  });

  it('an export hands back the places at once, so its fallback applies instead of never settling', async () => {
    const captures: MapCapture[] = [];
    render(TypeViewMap, { instances: INSTANCES, locationProperty: 'location', onOpenNote: vi.fn(), exportHooks: { onCaptured: (c) => captures.push(c) } });
    await waitFor(() => expect(captures).toHaveLength(1));
    expect(captures[0]).toEqual({
      ok: false,
      reason: MAP_NO_WEBGL,
      places: [
        { path: 'trip/Kampa.md', title: 'Kampa Museum', lat: 50.0835, lng: 14.4089 },
        { path: 'trip/Letna.md', title: 'Letná Park', lat: 50.097, lng: 14.424 },
      ],
    });
  });
});

describe('mapUnavailableReason (#3011)', () => {
  it("replaces MapLibre's WebGL advice with one line, and passes anything else through", () => {
    expect(mapUnavailableReason(new Error('WebGL2 is required to display this map. We are sorry…'))).toBe(MAP_NO_WEBGL);
    expect(mapUnavailableReason(new Error('Failed to initialize WebGL'))).toBe(MAP_NO_WEBGL);
    expect(mapUnavailableReason(new Error('Container not found'))).toBe("the map couldn't start (Container not found)");
    expect(mapUnavailableReason('boom')).toBe("the map couldn't start (boom)");
  });
});
