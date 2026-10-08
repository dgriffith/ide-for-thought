/**
 * @vitest-environment happy-dom
 *
 * An object view rendered for export (#2510) is the preview's own TypeView,
 * mounted off-screen, snapshotted once its rows are in, and torn down.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const { instancesMock, listMock, noteTypeMapMock } = vi.hoisted(() => ({
  instancesMock: vi.fn(), listMock: vi.fn(), noteTypeMapMock: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: instancesMock, list: listMock, noteTypeMap: noteTypeMapMock }, app: { getSystemLocale: async () => 'en-GB' } },
}));
vi.mock('../../../src/renderer/lib/map/load-maplibre', () => ({ loadMapLibre: vi.fn(() => new Promise(() => {})) }));

import { renderObjectViewForExport, OBJECT_VIEW_LOAD_TIMEOUT_MS } from '../../../src/renderer/lib/export/render-object-view';
import { renderLiveBlock } from '../../../src/renderer/lib/app/export-live-blocks';

const TYPE = {
  id: 'place', label: 'Place', classLocalName: 'Place', icon: '📍', source: 'user' as const,
  properties: [{ name: 'city', type: 'text' as const, label: 'City' }],
};
const INSTANCES = [
  { path: 'places/Kampa.md', title: 'Kampa Museum', values: { city: 'Prague' }, cover: null },
  { path: 'places/Széchenyi.md', title: 'Széchenyi Baths', values: { city: 'Budapest' }, cover: null },
];

beforeEach(() => {
  instancesMock.mockResolvedValue({ type: TYPE, instances: INSTANCES });
  listMock.mockResolvedValue({ types: [TYPE], errors: [] });
  noteTypeMapMock.mockResolvedValue({});
});
afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });

describe('renderObjectViewForExport', () => {
  it.each(['list', 'table', 'gallery'] as const)('renders the %s layout with every row linked, light-themed', async (layout) => {
    const html = await renderObjectViewForExport(JSON.stringify({ typeId: 'place', layout }));
    expect(instancesMock).toHaveBeenCalledWith('place');
    expect(html).toContain('class="minerva-live-block"');
    expect(html).toContain('data-theme="light"');
    expect(html).toContain('Kampa Museum');
    expect(html).toContain('Széchenyi Baths');
    expect(html).toContain('data-note-link="places/Kampa.md"');
    expect(html).toContain('data-note-link="places/Széchenyi.md"');
    expect(html).not.toContain('Loading…');
  });

  it('a kanban view exports its board without crashing, every card linked (#2602)', async () => {
    const PROJECT = {
      id: 'project', label: 'Project', classLocalName: 'Project', icon: '🚀', source: 'stock' as const,
      properties: [{ name: 'status', type: 'enum' as const, options: ['active', 'done'] }],
    };
    instancesMock.mockResolvedValue({ type: PROJECT, instances: [
      { path: 'p/Shed.md', title: 'Garden Shed', values: { status: 'active' }, cover: null },
      { path: 'p/Tax.md', title: 'Tax Return', values: { status: 'done' }, cover: null },
    ] });
    const html = await renderObjectViewForExport(JSON.stringify({ typeId: 'project', layout: 'kanban' }));
    expect(html).toContain('kb-board');
    expect(html).toContain('data-note-link="p/Shed.md"');
    expect(html).toContain('data-note-link="p/Tax.md"');
    expect(html).not.toContain('tabindex');
  });

  it('a timeline spec exports without crashing: an Event view as its drawing, linked and with no tab stops (#2608; #2609 owns the real export), another type as its default layout (#2607)', async () => {
    const EVENT = {
      id: 'event', label: 'Event', classLocalName: 'Event', icon: '📅', source: 'stock' as const,
      properties: [{ name: 'date', type: 'date' as const }, { name: 'end', type: 'date' as const }],
    };
    listMock.mockResolvedValue({ types: [TYPE, EVENT], errors: [] });
    instancesMock.mockResolvedValue({ type: EVENT, instances: [
      { path: 'e/Moon.md', title: 'Moon landing', values: { date: '1969-07-20', end: null }, cover: null },
    ] });
    const html = await renderObjectViewForExport(JSON.stringify({ typeId: 'event', layout: 'timeline', from: '1960', to: '1975' }));
    expect(html).toContain('tl-plot');
    expect(html).not.toContain('tl-toolbar');
    expect(html).toContain('data-note-link="e/Moon.md"');
    expect(html).not.toContain('tabindex');
    instancesMock.mockResolvedValue({ type: TYPE, instances: INSTANCES });
    const place = await renderObjectViewForExport(JSON.stringify({ typeId: 'place', layout: 'timeline', from: '1960' }));
    expect(place).toContain('tv-table');
    expect(place).toContain('data-note-link="places/Kampa.md"');
  });

  it('a calendar spec exports its month grid placed by dateBy, linked (#2702, #2704), a dateless type as its default layout (#2701)', async () => {
    const JOURNAL = {
      id: 'journal', label: 'Journal', classLocalName: 'Journal', icon: '📓', source: 'user' as const,
      properties: [{ name: 'published', type: 'date' as const }],
    };
    listMock.mockResolvedValue({ types: [TYPE, JOURNAL], errors: [] });
    instancesMock.mockResolvedValue({ type: JOURNAL, instances: [
      { path: 'j/Spring.md', title: 'Spring issue', values: { published: '2026-03-01' }, cover: null },
    ] });
    const html = await renderObjectViewForExport(JSON.stringify({ typeId: 'journal', layout: 'calendar', month: '2026-03', dateBy: 'published' }));
    expect(html).toContain('cal-export');
    expect(html).toContain('March 2026');
    expect(html).toContain('data-note-link="j/Spring.md"');
    instancesMock.mockResolvedValue({ type: TYPE, instances: INSTANCES });
    const place = await renderObjectViewForExport(JSON.stringify({ typeId: 'place', layout: 'calendar', month: '2026-03' }));
    expect(place).toContain('tv-table');
    expect(place).toContain('data-note-link="places/Kampa.md"');
  });

  it('draws a calendar in export mode: the spec\'s month, every event a link in its day\'s cell, the bands and Undated tray after it, nothing interactive (#2704)', async () => {
    const EVENT = {
      id: 'event', label: 'Event', classLocalName: 'Event', icon: '📅', source: 'stock' as const,
      properties: [{ name: 'date', type: 'datetime' as const }, { name: 'end', type: 'datetime' as const }],
    };
    const busy = Array.from({ length: 8 }, (_, i) => ({ path: `e/Busy ${i}.md`, title: `Busy ${i}`, values: { date: `1969-07-21T${String(9 + i).padStart(2, '0')}:00`, end: null }, cover: null }));
    listMock.mockResolvedValue({ types: [TYPE, EVENT], errors: [] });
    instancesMock.mockResolvedValue({ type: EVENT, instances: [
      { path: 'e/Moon.md', title: 'Moon landing', values: { date: '1969-07-20', end: null }, cover: null },
      { path: 'e/Apollo.md', title: 'Apollo 11', values: { date: '1969-07-16', end: '1969-07-24' }, cover: null },
      { path: 'e/Summer.md', title: 'Summer camp', values: { date: '1969-07-28', end: '1969-08' }, cover: null },
      { path: 'e/Heatwave.md', title: 'Heatwave', values: { date: '1969-07', end: null }, cover: null },
      { path: 'e/Year.md', title: 'Year of the Moon', values: { date: '1969', end: null }, cover: null },
      { path: 'e/Someday.md', title: 'Someday', values: { date: null, end: null }, cover: null },
      ...busy,
    ] });
    const html = await renderObjectViewForExport(JSON.stringify({ typeId: 'event', layout: 'calendar', month: '1969-07' }));
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const table = doc.querySelector('.cal-export [role="table"]')!;
    expect(table.getAttribute('aria-label')).toBe('July 1969');
    // Every event of a busy day is in its cell, each a link main resolves; no "+N more".
    const busyCell = [...table.querySelectorAll('[role="cell"]')].find((c) => c.querySelector('a[data-note-link="e/Busy 0.md"]'))!;
    expect([...busyCell.querySelectorAll('a[data-note-link^="e/Busy"]')]).toHaveLength(8);
    expect(doc.querySelector('.cal-more')).toBeNull();
    const linked = new Set([...doc.querySelectorAll('a[data-note-link]')].map((a) => a.getAttribute('data-note-link')));
    for (const p of ['e/Moon.md', 'e/Apollo.md', 'e/Summer.md', 'e/Heatwave.md', 'e/Year.md', 'e/Someday.md', ...busy.map((b) => b.path)]) expect(linked.has(p), p).toBe(true);
    // A hatched bar, and the legend that explains it.
    expect(doc.querySelector('a[data-note-link="e/Summer.md"] .calx-hatch')).not.toBeNull();
    expect(doc.querySelector('.calx-legend')!.textContent).toContain('approximate');
    // The bands and the tray follow the grid in the page.
    const after = (a: Element, b: Element) => (a.compareDocumentPosition(b) & 4) !== 0;
    expect(after(table, doc.querySelector('[data-band="month"]')!)).toBe(true);
    expect(after(doc.querySelector('[data-band="month"]')!, doc.querySelector('.cal-undated')!)).toBe(true);
    // Nothing interactive, and never the spec.
    for (const sel of ['button', 'input', 'select', '[tabindex]', '[role="grid"]', '[role="gridcell"]', '[aria-current]', '[role="tooltip"]', '[role="dialog"]', '.cal-nav']) {
      expect(doc.querySelector(sel), sel).toBeNull();
    }
    expect(html).not.toContain('&quot;typeId&quot;');
    expect(html).not.toContain('"typeId"');
  });

  it('draws a timeline in export mode: the range at 760px, every event a link, the dated and Undated lists after it, nothing interactive (#2609)', async () => {
    const EVENT = {
      id: 'event', label: 'Event', classLocalName: 'Event', icon: '📅', source: 'stock' as const,
      properties: [{ name: 'date', type: 'datetime' as const }, { name: 'end', type: 'datetime' as const }],
    };
    listMock.mockResolvedValue({ types: [TYPE, EVENT], errors: [] });
    instancesMock.mockResolvedValue({ type: EVENT, instances: [
      { path: 'e/Moon.md', title: 'Moon landing', values: { date: '1969-07-20', end: null }, cover: null },
      { path: 'e/Apollo.md', title: 'Apollo 11', values: { date: '1969-07-16', end: '1969-07-24' }, cover: null },
      { path: 'e/Woodstock.md', title: 'Woodstock', values: { date: '1969-08', end: null }, cover: null },
      { path: 'e/Standup.md', title: 'Standup', values: { date: '1969-07-21T09:30', end: null }, cover: null },
      { path: 'e/War.md', title: 'Thirty Years War', values: { date: '1618', end: '1648' }, cover: null },
      { path: 'e/Someday.md', title: 'Someday', values: { date: null, end: null }, cover: null },
    ] });
    const html = await renderObjectViewForExport(JSON.stringify({ typeId: 'event', layout: 'timeline', from: '1969-07', to: '1969-08' }));
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const plot = doc.querySelector('.tl-export .tl-plot')!;
    expect(plot.getAttribute('width')).toBe('760');
    // Each drawn event is a link main resolves; the out-of-range war isn't drawn.
    const drawn = [...plot.querySelectorAll('[data-timeline-event]')];
    expect(drawn.every((a) => a.tagName.toLowerCase() === 'a')).toBe(true);
    expect(drawn.map((a) => a.getAttribute('data-note-link')).sort()).toEqual(['e/Apollo.md', 'e/Moon.md', 'e/Standup.md', 'e/Woodstock.md']);
    expect(drawn.find((a) => a.getAttribute('data-note-link') === 'e/Moon.md')!.getAttribute('aria-label')).toMatch(/^Moon landing, /);
    // The hatch travels with the drawing, and its legend says what it means.
    expect(plot.querySelector('pattern')).not.toBeNull();
    expect(doc.querySelector('.tl-legend')!.textContent).toContain('approximate');
    expect(doc.querySelector('.tl-outside')!.textContent).toBe('1 more falls outside this range.');
    // The dated list, then the Undated one: linked titles.
    expect([...doc.querySelectorAll('.tl-export-row a[data-note-link]')].map((a) => a.textContent)).toEqual(['Apollo 11', 'Moon landing', 'Standup', 'Woodstock']);
    expect(doc.querySelector('.tl-undated a[data-note-link="e/Someday.md"]')).not.toBeNull();
    // Nothing interactive, and never the spec.
    for (const sel of ['button', 'input', 'select', '[tabindex]', '[role="link"]', '[aria-pressed]', '[data-export-omit]', '.tl-toolbar', '.tl-ring', '[role="tooltip"]']) {
      expect(doc.querySelector(sel), sel).toBeNull();
    }
    expect(html).not.toContain('&quot;typeId&quot;');
    expect(html).not.toContain('"typeId"');
  });

  it('a timeline export honours dateBy: placed by the chosen property, and only Event\'s date/end pair makes a bar (#2715)', async () => {
    const JOURNAL = {
      id: 'journal', label: 'Journal', classLocalName: 'Journal', icon: '📓', source: 'user' as const,
      properties: [{ name: 'published', type: 'date' as const }, { name: 'revised', type: 'date' as const }],
    };
    listMock.mockResolvedValue({ types: [TYPE, JOURNAL], errors: [] });
    instancesMock.mockResolvedValue({ type: JOURNAL, instances: [
      { path: 'j/Spring.md', title: 'Spring issue', values: { published: '2026-03-01', revised: '1999-05-02' }, cover: null },
      { path: 'j/Autumn.md', title: 'Autumn issue', values: { published: '2026-10-01', revised: '1998-01-15' }, cover: null },
    ] });
    // The range covers the `revised` dates and none of the `published` ones.
    const html = await renderObjectViewForExport(JSON.stringify({ typeId: 'journal', layout: 'timeline', from: '1998', to: '1999', dateBy: 'revised' }));
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const labels = [...doc.querySelectorAll('.tl-plot [data-timeline-event]')].map((a) => a.getAttribute('aria-label'));
    expect(labels.sort()).toEqual(['Autumn issue, Jan 15, 1998', 'Spring issue, May 2, 1999']);
    expect([...doc.querySelectorAll('.tl-export-row a[data-note-link]')].map((a) => a.textContent)).toEqual(['Autumn issue', 'Spring issue']);
    expect(doc.querySelector('.tl-outside')).toBeNull();

    // An Event subtype dated by its other date property: points, though `end` is written.
    const EVENT = {
      id: 'event', label: 'Event', classLocalName: 'Event', icon: '📅', source: 'stock' as const,
      properties: [{ name: 'date', type: 'date' as const }, { name: 'end', type: 'date' as const }, { name: 'announced', type: 'date' as const }],
    };
    listMock.mockResolvedValue({ types: [TYPE, EVENT], errors: [] });
    instancesMock.mockResolvedValue({ type: EVENT, instances: [
      { path: 'e/Apollo.md', title: 'Apollo 11', values: { date: '1969-07-16', end: '1969-07-24', announced: '1969-01-09' }, cover: null },
    ] });
    const byAnnounced = new DOMParser().parseFromString(await renderObjectViewForExport(JSON.stringify({ typeId: 'event', layout: 'timeline', dateBy: 'announced' })), 'text/html');
    expect(byAnnounced.querySelector('[data-timeline-event]')!.getAttribute('aria-label')).toBe('Apollo 11, Jan 9, 1969');
    const byDate = new DOMParser().parseFromString(await renderObjectViewForExport(JSON.stringify({ typeId: 'event', layout: 'timeline' })), 'text/html');
    expect(byDate.querySelector('[data-timeline-event]')!.getAttribute('aria-label')).toMatch(/^Apollo 11, Jul 16, 1969 – Jul 24, 1969$/);
  });

  it('a kanban export honours the column order and Show empty columns, read-only (#2614)', async () => {
    const PROJECT = {
      id: 'project', label: 'Project', classLocalName: 'Project', icon: '🚀', source: 'stock' as const,
      properties: [{ name: 'status', type: 'enum' as const, options: ['active', 'paused', 'done'] }],
    };
    instancesMock.mockResolvedValue({ type: PROJECT, instances: [
      { path: 'p/Shed.md', title: 'Garden Shed', values: { status: 'active' }, cover: null },
      { path: 'p/Tax.md', title: 'Tax Return', values: { status: 'done' }, cover: null },
    ] });
    const html = await renderObjectViewForExport(JSON.stringify({ typeId: 'project', layout: 'kanban', columnOrder: ['done'], showEmptyColumns: false }));
    const order = [...html.matchAll(/data-column-value="([^"]*)"/g)].map((m) => m[1]);
    expect(order).toEqual(['done', 'active']); // paused is empty, so hidden
    expect(html).not.toContain('kb-col-menu-btn');
    expect(html).not.toContain('data-draggable');
  });

  it('draws a kanban board in export mode: wrapped columns, linked cards, nothing interactive (#2604)', async () => {
    const PROJECT = {
      id: 'project', label: 'Project', classLocalName: 'Project', icon: '🚀', source: 'stock' as const,
      properties: [{ name: 'status', type: 'enum' as const, options: ['active', 'paused', 'done', 'abandoned'] }, { name: 'owner', type: 'text' as const, label: 'Owner' }],
    };
    instancesMock.mockResolvedValue({ type: PROJECT, instances: [
      { path: 'p/Shed.md', title: 'Garden Shed', values: { status: 'active', owner: 'Ana' }, cover: null },
      { path: 'p/Tax.md', title: 'Tax Return', values: { status: 'done', owner: 'Bo' }, cover: null },
      { path: 'p/Loose.md', title: 'Loose End', values: {}, cover: null },
    ] });
    const html = await renderObjectViewForExport(JSON.stringify({ typeId: 'project', layout: 'kanban', columns: ['owner'] }));
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const board = doc.querySelector('.kb-board')!;
    // Export mode: the class whose rules wrap the columns into a grid.
    expect(board.classList.contains('kb-export')).toBe(true);
    // Every column keeps its header and count — the empty ones too (Show empty columns defaults on).
    const cols = [...board.querySelectorAll('.kb-column')];
    expect(cols.map((c) => c.querySelector('.kb-col-label')?.textContent)).toEqual(['active', 'paused', 'done', 'abandoned', 'No value']);
    expect(cols.map((c) => c.querySelector('.kb-col-count')?.textContent)).toEqual(['1', '0', '1', '0', '1']);
    // Every card is shown, as a link main resolves under the export's policy.
    const cards = [...board.querySelectorAll('.kb-card')];
    expect(cards.map((c) => [c.tagName, c.getAttribute('data-note-link'), c.querySelector('.kb-card-name')?.textContent])).toEqual([
      ['A', 'p/Shed.md', 'Garden Shed'], ['A', 'p/Tax.md', 'Tax Return'], ['A', 'p/Loose.md', 'Loose End'],
    ]);
    expect(html).toContain('Ana'); // the view's visible property
    // Nothing interactive survives: no controls, no focus stops, no drag or menu affordances.
    expect(board.querySelectorAll('button, input, select, [role="menu"], [tabindex]')).toHaveLength(0);
    for (const attr of ['aria-pressed', 'aria-haspopup', 'data-draggable', 'data-export-omit', 'kb-col-menu-btn']) expect(html).not.toContain(attr);
  });

  it('honours the saved sort, as the preview does', async () => {
    const html = await renderObjectViewForExport(JSON.stringify({ typeId: 'place', layout: 'table', sortColumn: '__title', sortDir: 'desc' }));
    expect(html.indexOf('Széchenyi Baths')).toBeLessThan(html.indexOf('Kampa Museum'));
  });

  it('leaves nothing behind in the document', async () => {
    await renderObjectViewForExport(JSON.stringify({ typeId: 'place', layout: 'list' }));
    expect(document.body.children).toHaveLength(0);
  });

  it('reports a bad spec in the preview\'s own words', async () => {
    await expect(renderObjectViewForExport('{"layout":"list"}')).rejects.toThrow('"typeId" is required');
  });

  it('gives up on a view that never loads, cleaning up', async () => {
    vi.useFakeTimers();
    instancesMock.mockReturnValue(new Promise(() => {}));
    const p = renderObjectViewForExport(JSON.stringify({ typeId: 'place', layout: 'list' }));
    const caught = p.catch((e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(OBJECT_VIEW_LOAD_TIMEOUT_MS);
    expect(await caught).toMatch(/too long/);
    expect(document.body.children).toHaveLength(0);
  });
});

describe('renderLiveBlock', () => {
  it('turns a failure into that block\'s error, not a thrown request', async () => {
    const r = await renderLiveBlock({ id: 'B0', kind: 'object-view', source: 'not json', notePath: 'n.md' });
    expect(r.ok).toBe(false);
  });
});
