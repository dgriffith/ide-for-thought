/**
 * @vitest-environment happy-dom
 *
 * The Type filter in the view panel (#2716): a Place view offers its subtypes
 * as a tree with counts in scope, narrows to the chosen ones hierarchically,
 * drops a stale id, and copies as the same `object-view` block.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen, within } from '@testing-library/svelte';

const { instancesMock, listMock, noteTypeMapMock } = vi.hoisted(() => ({
  instancesMock: vi.fn(), listMock: vi.fn(), noteTypeMapMock: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: instancesMock, list: listMock, noteTypeMap: noteTypeMapMock }, export: { csv: vi.fn() }, app: { getSystemLocale: async () => 'en-GB' } },
}));
vi.mock('../../../src/renderer/lib/map/load-maplibre', () => ({ loadMapLibre: vi.fn(() => new Promise(() => {})) }));

import TypeView from '../../../src/renderer/lib/components/TypeView.svelte';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';
import { parseObjectViewSpec } from '../../../src/renderer/lib/markdown/object-view-renderer';
import type { ViewFilter } from '../../../src/shared/objects/view-spec';

const PLACE = {
  id: 'place', label: 'Place', classLocalName: 'Place', icon: '📍', source: 'user' as const,
  properties: [{ name: 'city', type: 'text' as const, label: 'City' }],
};
const sub = (id: string, label: string, parent: string, icon: string) => ({ id, label, classLocalName: label, icon, parent, source: 'user' as const, properties: [] });
const CATALOG = [PLACE, sub('restaurant', 'Restaurant', 'place', '🍽'), sub('pizzeria', 'Pizzeria', 'restaurant', '🍕'), sub('museum', 'Museum', 'place', '🏛')];
const inst = (name: string, city: string) => ({ path: `p/${name}.md`, title: name, values: { city }, cover: null });
const INSTANCES = [inst('Bistro', 'Paris'), inst('Luigi', 'Prague'), inst('Louvre', 'Paris'), inst('Park', 'Prague')];
const OWN = { 'p/Bistro.md': 'restaurant', 'p/Luigi.md': 'pizzeria', 'p/Louvre.md': 'museum', 'p/Park.md': 'place' };

async function seed(types: unknown[] = CATALOG, map: Record<string, string> = OWN) {
  listMock.mockResolvedValue({ types, errors: [] });
  noteTypeMapMock.mockResolvedValue(map);
  await objectTypesStore.refresh();
}
function props(filters: ViewFilter[] = [], over: Record<string, unknown> = {}) {
  return { typeId: 'place', layout: 'list' as const, sortColumn: null, sortDir: 'asc' as const, columns: null, revision: 0, onStateChange: vi.fn(), onOpenNote: vi.fn(), filters, ...over };
}
const rows = (c: HTMLElement) => [...c.querySelectorAll('.tv-list-title')].map((t) => t.textContent);

beforeEach(async () => {
  instancesMock.mockResolvedValue({ type: PLACE, instances: INSTANCES });
  await seed();
});
afterEach(async () => { cleanup(); await seed([], {}); instancesMock.mockReset(); });

describe('the Type filter in the view panel (#2716)', () => {
  it('offers Type first, as the subtypes\' tree with counts in scope, and ticking one sets the filter', async () => {
    const p = props([{ property: 'city', values: ['Prague'] }]);
    render(TypeView, p);
    await waitFor(() => expect(screen.getByText('Luigi')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Filter ▾' }));
    const dialog = screen.getByRole('dialog', { name: 'Filter by property' });
    expect(within(dialog).getAllByRole('button').map((b) => b.textContent.trim())).toEqual(['Type', 'City Prague']);
    await fireEvent.click(within(dialog).getByRole('button', { name: 'Type' }));
    const tree = screen.getByRole('list', { name: 'Subtypes' });
    const labels = within(tree).getAllByRole('checkbox').map((c) => c.closest('label')!);
    // Museum, Restaurant → Pizzeria; counted in Prague only (the city filter).
    expect(labels.map((l) => l.textContent.replace(/\s+/g, ' ').trim())).toEqual(['🏛 Museum0', '🍽 Restaurant1', '🍕 Pizzeria1']);
    expect(labels.map((l) => l.style.paddingLeft)).toEqual(['4px', '4px', '20px']);
    await fireEvent.click(within(tree).getByRole('checkbox', { name: /Restaurant/ }));
    expect(p.onStateChange).toHaveBeenLastCalledWith({ filters: [{ property: 'city', values: ['Prague'] }, { property: 'type', values: ['restaurant'] }] });
  });

  it('narrows hierarchically: Restaurant keeps the Pizzeria, drops the Museum and the plain Place', async () => {
    const { container } = render(TypeView, props([{ property: 'type', values: ['restaurant'] }]));
    await waitFor(() => expect(screen.getByText('Luigi')).toBeTruthy());
    expect(rows(container)).toEqual(['Bistro', 'Luigi']);
    expect(container.querySelector('.tv-count')!.textContent).toBe('2 of 4');
    expect(screen.getByRole('button', { name: 'Type: Restaurant' })).toBeTruthy();
  });

  it('drops a stale id — and the whole filter when nothing is left', async () => {
    const { container } = render(TypeView, props([{ property: 'type', values: ['gone'] }]));
    await waitFor(() => expect(screen.getByText('Louvre')).toBeTruthy());
    expect(rows(container)).toHaveLength(4);
    expect(screen.queryByRole('button', { name: /^Type:/ })).toBeNull();
  });

  it('a type with no subtypes is not offered Type', async () => {
    await seed([PLACE], {});
    render(TypeView, props());
    await waitFor(() => expect(screen.getByText('Louvre')).toBeTruthy());
    await fireEvent.click(screen.getByRole('button', { name: 'Filter ▾' }));
    expect(within(screen.getByRole('dialog', { name: 'Filter by property' })).getAllByRole('button').map((b) => b.textContent.trim())).toEqual(['City']);
  });

  it('Copy as markdown round-trips it through the fence, stale ids dropped', async () => {
    const writeText = vi.fn();
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    render(TypeView, props([{ property: 'type', values: ['museum', 'gone'] }], { layout: 'map' }));
    await fireEvent.click(await screen.findByText('Copy as markdown'));
    const md = writeText.mock.calls[0]![0] as string;
    const spec = parseObjectViewSpec(md.replace(/^```object-view\n/, '').replace(/\n```\n$/, ''));
    expect(spec).toMatchObject({ typeId: 'place', layout: 'map', filters: [{ property: 'type', values: ['museum'] }] });
  });

  it('an embed (chromeless) honours it read-only', async () => {
    const { container } = render(TypeView, props([{ property: 'type', values: ['pizzeria', 'museum'] }], { chromeless: true }));
    await waitFor(() => expect(screen.getByText('Luigi')).toBeTruthy());
    expect(rows(container)).toEqual(['Luigi', 'Louvre']);
    expect(container.querySelector('.tv-filters')).toBeNull();
  });
});
