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
import type { TypeInfo, TypeInstanceRow } from '../../../src/shared/objects/type-def';

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

import TypeViewKanban from '../../../src/renderer/lib/components/TypeViewKanban.svelte';
import TypeViewTimeline from '../../../src/renderer/lib/components/TypeViewTimeline.svelte';
import TypeViewMap from '../../../src/renderer/lib/components/TypeViewMap.svelte';
import { boardColumns } from '../../../src/shared/objects/kanban';

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
const PROJECT: TypeInfo = {
  id: 'project', label: 'Project', classLocalName: 'Project', icon: '🚀', source: 'stock',
  properties: [
    { name: 'status', type: 'enum', options: ['active', 'done'] },
    { name: 'owner', type: 'text', label: 'Owner' },
  ],
};
const prow = (path: string, title: string, values: Record<string, string | null>): TypeInstanceRow =>
  ({ path, title, values: { status: null, owner: null, ...values }, cover: null });

function renderKanban(over: Record<string, unknown> = {}) {
  const instances = [prow('projects/alpha.md', 'Project Alpha', { status: 'active', owner: 'Ann' }), prow('projects/bravo.md', 'Bravo', { status: 'done' })];
  const group = PROJECT.properties[0]!;
  return render(TypeViewKanban, {
    type: PROJECT, properties: PROJECT.properties, group,
    columns: boardColumns(instances, group),
    visible: null, display: (_p: unknown, v: string | null) => v ?? '', rowType: () => PROJECT,
    isSelected: () => false, selectable: false, onCardClick: vi.fn(), onCardContextMenu: vi.fn(),
    ...over,
  });
}
const kanbanCard = (path: string) => document.querySelector<HTMLElement>(`[data-kanban-card][data-note-path="${path}"]`)!;

describe('Kanban cards (#2710)', () => {
  it('hovering a card shows the note-link preview, with the card fields as its strip; no native path tooltip', async () => {
    renderKanban();
    const card = kanbanCard('projects/alpha.md');
    expect(card.hasAttribute('title')).toBe(false);
    await fireEvent.pointerEnter(card);
    const tip = await openPreview();
    expectLinkContent(tip, await linkHover('projects/alpha'));
    expect(tip.querySelector('.nhp-fields')!.textContent).toContain('Owner');
    expect(tip.querySelector('.nhp-fields')!.textContent).toContain('Ann');
    // The grouping property is the column, so it isn't repeated.
    expect(tip.querySelector('.nhp-fields')!.textContent).not.toContain('active');
    expect(card.getAttribute('aria-describedby')).toBe(tip.id);
    await fireEvent.pointerLeave(card);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('keyboard focus shows it at once, without moving focus; Escape closes it', async () => {
    renderKanban();
    const card = kanbanCard('projects/bravo.md');
    card.focus();
    const tip = await openPreview();
    expectLinkContent(tip, await linkHover('projects/bravo'));
    expect(document.activeElement).toBe(card);
    await fireEvent.keyDown(card, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    expect(card.hasAttribute('aria-describedby')).toBe(false);
    expect(document.activeElement).toBe(card);
  });

  it('moving onto the preview keeps it open', async () => {
    renderKanban();
    const card = kanbanCard('projects/alpha.md');
    await fireEvent.pointerEnter(card);
    const tip = await openPreview();
    await fireEvent.pointerLeave(card);
    await fireEvent.pointerEnter(tip);
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.getByRole('tooltip')).toBe(tip);
    await fireEvent.pointerLeave(tip);
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
  });

  it('an export mounts no preview', async () => {
    renderKanban({ exportMode: true });
    await fireEvent.pointerEnter(kanbanCard('projects/alpha.md'));
    await new Promise((r) => setTimeout(r, 400));
    expect(document.querySelector('[role="tooltip"], .note-hover-preview')).toBeNull();
  });
});

// ── Timeline ───────────────────────────────────────────────────────────────
const EVENT: TypeInfo = {
  id: 'event', label: 'Event', classLocalName: 'Event', icon: '📅', source: 'stock',
  properties: [
    { name: 'date', type: 'datetime' },
    { name: 'end', type: 'datetime' },
    { name: 'location', type: 'text', label: 'Location' },
  ],
};
const erow = (path: string, title: string, date: string | null, end: string | null = null, location: string | null = null): TypeInstanceRow =>
  ({ path, title, values: { date, end, location }, cover: null });

function renderTimeline(over: Record<string, unknown> = {}) {
  return render(TypeViewTimeline, {
    type: EVENT, properties: EVENT.properties,
    instances: [erow('events/moon.md', 'Moon landing', '1969-07-20', null, 'Sea of Tranquility'), erow('events/woodstock.md', 'Woodstock', '1969-08'), erow('events/typo.md', 'Typo', '1972-05-01', '1971-01-01')],
    filters: [], from: null, to: null,
    display: (_p: unknown, v: string | null) => v ?? '', rowType: () => EVENT,
    onOpenNote: vi.fn(), onStateChange: vi.fn(), locale: 'en-GB',
    ...over,
  });
}
const tlEvent = (path: string) => document.querySelector<SVGGElement>(`[data-timeline-event][data-note-path="${path}"]`)!;

describe('Timeline events (#2710)', () => {
  it('hovering an event shows the note-link preview, its dates as extra lines, and its fields', async () => {
    renderTimeline();
    await fireEvent.pointerEnter(tlEvent('events/moon.md'));
    const tip = await openPreview();
    expectLinkContent(tip, await linkHover('events/moon'));
    expect(tip.querySelector('.nhp-extra')!.textContent).toContain('20 Jul 1969');
    expect(tip.querySelector('.nhp-fields')!.textContent).toContain('Sea of Tranquility');
    // `date` / `end` head the preview; they aren't repeated as fields.
    expect(tip.querySelector('.nhp-fields')!.textContent).not.toContain('1969-07-20');
  });

  it('focusing an event shows it, with "approximate" for a partial date', async () => {
    renderTimeline();
    tlEvent('events/woodstock.md').focus();
    const tip = await openPreview();
    expectLinkContent(tip, await linkHover('events/woodstock'));
    expect(tip.querySelector('.nhp-extra')!.textContent).toContain('approximate');
    expect(tlEvent('events/woodstock.md').getAttribute('aria-describedby')).toBe(tip.id);
  });

  it('keeps the ⚠ ignored-end flag, and Escape closes it', async () => {
    renderTimeline();
    tlEvent('events/typo.md').focus();
    const tip = await openPreview();
    expect(tip.querySelector('[data-end-issue]')!.textContent).toContain('⚠ End date ignored');
    await fireEvent.keyDown(tlEvent('events/typo.md'), { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('tooltip')).toBeNull());
    expect(document.activeElement).toBe(tlEvent('events/typo.md'));
  });

  it('a read-only embed has the hover too; an export has none', async () => {
    renderTimeline({ readOnly: true });
    await fireEvent.pointerEnter(tlEvent('events/moon.md'));
    expectLinkContent(await openPreview(), await linkHover('events/moon'));
    cleanup();
    renderTimeline({ exportMode: true });
    tlEvent('events/moon.md')?.dispatchEvent(new Event('pointerenter'));
    await new Promise((r) => setTimeout(r, 400));
    expect(document.querySelector('.note-hover-preview')).toBeNull();
  });
});

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
