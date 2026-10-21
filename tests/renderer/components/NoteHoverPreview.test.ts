/**
 * @vitest-environment happy-dom
 *
 * One link-hover preview for the type views (#2710, part 1). The Kanban
 * board, the Timeline and the map each show the shared `NoteHoverPreview` on
 * hover — and Kanban and the Timeline on keyboard focus too — with the SAME
 * title and snippet `makeNotePreviewFetcher` gives a `[[link]]` to the note,
 * the type's card fields as a properties strip, and (the Timeline) its own
 * extra lines. `role="tooltip"`, named by the item's `aria-describedby`;
 * Escape closes it; it never takes focus; none mounts in export mode.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/svelte';
import { makeNotePreviewFetcher, type NotePreviewDeps } from '../../../src/renderer/lib/editor/note-preview';
import type { TypeInfo } from '../../../src/shared/objects/type-def';

const { NOTES, markerInstances, FakeMap, FakeMarker, FakeNavigationControl, FakeLngLatBounds } = vi.hoisted(() => {
  const NOTES: Record<string, string> = {
    'events/moon.md': '---\ntype: event\ndate: 1969-07-20\n---\n# Moon landing\n\nThe Eagle has landed at Tranquility Base.\n\n## Aftermath\n\nLater.',
    'events/woodstock.md': '---\ntype: event\ndate: 1969-08\n---\n# Woodstock\n\nThree days of peace and music.',
    'events/typo.md': '---\ntype: event\ndate: 1972-05-01\nend: 1971-01-01\n---\n# Typo\n\nAn end before the start.',
    'projects/alpha.md': '---\ntitle: Project Alpha\ntype: project\nstatus: active\n---\n\nAlpha opens with this sentence.',
    'projects/bravo.md': '# Bravo\n\nBravo body.',
    'places/sf.md': '# San Francisco\n\nFog and hills.',
  };
  const markerInstances: InstanceType<typeof FakeMarker>[] = [];
  class FakeLngLatBounds { extend(): this { return this; } isEmpty(): boolean { return false; } }
  class FakeMarker {
    el = document.createElement('div');
    setLngLat(): this { return this; }
    addTo(): this { document.body.appendChild(this.el); markerInstances.push(this); return this; }
    getElement(): HTMLElement { return this.el; }
    remove(): void { this.el.remove(); }
  }
  class FakeNavigationControl {}
  class FakeMap {
    constructor(_opts: unknown) {}
    addControl(): void {}
    resize(): void {}
    fitBounds(): void {}
    setCenter(): void {}
    setZoom(): void {}
    setStyle(): void {}
    remove(): void {}
  }
  return { NOTES, markerInstances, FakeMap, FakeMarker, FakeNavigationControl, FakeLngLatBounds };
});

// The views' fetcher is the app's (`appNotePreviewFetcher`); here, the same
// factory over a fixed thoughtbase, so a "link hover" can be computed beside it.
const deps: NotePreviewDeps = {
  getNotePaths: () => Object.keys(NOTES),
  readNote: (p) => (p in NOTES ? Promise.resolve(NOTES[p]!) : Promise.reject(new Error('ENOENT'))),
};
vi.mock('../../../src/renderer/lib/components/note-hover/app-fetcher', async () => {
  const { makeNotePreviewFetcher: make } = await import('../../../src/renderer/lib/editor/note-preview');
  const f = make({
    getNotePaths: () => Object.keys(NOTES),
    readNote: (p: string) => (p in NOTES ? Promise.resolve(NOTES[p]!) : Promise.reject(new Error('ENOENT'))),
  });
  return { appNotePreviewFetcher: () => f };
});
vi.mock('../../../src/renderer/lib/map/load-maplibre', () => ({
  loadMapLibre: vi.fn().mockResolvedValue({ Map: FakeMap, Marker: FakeMarker, NavigationControl: FakeNavigationControl, LngLatBounds: FakeLngLatBounds }),
}));
vi.mock('../../../src/renderer/lib/map/maplibre-style', () => ({
  mapStyleUrl: () => 'https://tiles.openfreemap.org/styles/liberty',
  resolveMapStyle: () => 'light',
  exportStyleUrl: () => 'https://tiles.openfreemap.org/styles/liberty',
}));

import TypeViewMap from '../../../src/renderer/lib/components/TypeViewMap.svelte';

/** What hovering `[[target]]` in a note shows. */
async function linkHover(target: string): Promise<{ title: string; snippet: string }> {
  const p = await makeNotePreviewFetcher(deps)(target);
  return { title: p!.title, snippet: p!.snippet };
}

/** The open preview, once its note has loaded. */
async function openPreview(): Promise<HTMLElement> {
  const tip = await screen.findByRole('tooltip', {}, { timeout: 2000 });
  await waitFor(() => expect(tip.querySelector('.nhp-snippet:not(.nhp-loading)')).not.toBeNull());
  return tip;
}
function expectLinkContent(tip: HTMLElement, link: { title: string; snippet: string }): void {
  expect(tip.querySelector('.nhp-title-text')!.textContent).toBe(link.title);
  expect(tip.querySelector('.nhp-snippet')!.textContent).toBe(link.snippet);
}

afterEach(() => { cleanup(); markerInstances.length = 0; });

// ── Kanban ─────────────────────────────────────────────────────────────────
// Kanban cards' previews (#2710) are the Kanban plugin's since #2828: its board asks for
// them (tests/plugins/kanban/Board.test.ts), PluginFrame draws them (PluginFrame.test.ts),
// PluginLayout fills their strip (PluginLayout.test.ts), and note-hover-preview.spec.ts
// checks the whole of it in the app.

// ── Timeline ───────────────────────────────────────────────────────────────
// The Timeline is the Timeline plugin's since #2829, in its frame: it asks for
// this preview with its dates as extra lines and its dates off the strip
// (tests/plugins/timeline/Timeline.test.ts), PluginFrame draws the lines and
// PluginLayout leaves those fields out (PluginLayout.test.ts), and
// note-hover-preview.spec.ts checks the whole of it in the app.

// ── Map ────────────────────────────────────────────────────────────────────
const PLACE: TypeInfo = {
  id: 'place', label: 'Place', classLocalName: 'Place', icon: '📍', source: 'stock',
  properties: [{ name: 'location', type: 'geo' }, { name: 'kind', type: 'text', label: 'Kind' }],
};

describe('map pins (#2710)', () => {
  it('hovering a pin shows the note-link preview with the card fields, replacing the native tooltip', async () => {
    render(TypeViewMap, {
      instances: [{ path: 'places/sf.md', title: 'San Francisco', values: { location: '37.77,-122.41', kind: 'City' }, cover: null }],
      locationProperty: 'location', onOpenNote: vi.fn(), type: PLACE, properties: PLACE.properties,
    });
    await waitFor(() => expect(markerInstances).toHaveLength(1));
    const pin = markerInstances[0]!.getElement();
    expect(pin.title).toBe('');
    await fireEvent.pointerEnter(pin);
    const tip = await openPreview();
    expectLinkContent(tip, await linkHover('places/sf'));
    expect(tip.querySelector('.nhp-fields')!.textContent).toContain('City');
    expect(pin.getAttribute('aria-describedby')).toBe(tip.id);
    await fireEvent.keyDown(document.body, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });
});
