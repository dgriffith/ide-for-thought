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
    addTo(): this { pins.push(this.el); return this; }
    getElement(): HTMLElement { return this.el; }
    remove(): void {}
  }
  class FakeMap {
    addControl(): void {}
    resize(): void {}
    fitBounds(): void {}
    setCenter(): void {}
    setZoom(): void {}
    setStyle(): void {}
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
