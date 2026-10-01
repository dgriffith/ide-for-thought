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
  api: { types: { instances: instancesMock, list: listMock, noteTypeMap: noteTypeMapMock } },
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
