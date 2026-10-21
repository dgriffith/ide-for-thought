/**
 * @vitest-environment happy-dom
 *
 * A layout a built-in plugin draws, with the plugin off (#2828): the view
 * shows the table with one quiet line, keeps its layout, and doesn't offer
 * the layout in the switcher. Kanban becomes plugin-drawn in #2828's last
 * part; here the registry is told it is.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, cleanup, screen, within } from '@testing-library/svelte';

const h = vi.hoisted(() => ({ on: false, instances: vi.fn(), list: vi.fn(), map: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { instances: h.instances, list: h.list, noteTypeMap: h.map } },
}));
vi.mock('../../../src/renderer/lib/stores/core-plugins.svelte', () => ({
  corePluginsStore: { isOn: () => h.on, name: () => 'Kanban' },
}));
vi.mock('../../../src/shared/objects/view-layouts', async (importOriginal) => {
  const real = await importOriginal<typeof import('../../../src/shared/objects/view-layouts')>();
  const VIEW_LAYOUTS = real.VIEW_LAYOUTS.map((l) => (l.id === 'kanban' ? { ...l, plugin: 'kanban' } : l));
  return {
    ...real,
    VIEW_LAYOUTS,
    layoutPlugin: (id: string) => (id === 'kanban' ? 'kanban' : null),
    layoutAvailable: (id: string, on: ((p: string) => boolean) | undefined) => id !== 'kanban' || (on?.('kanban') ?? true),
    layoutsFor: (ctx: Parameters<typeof real.layoutsFor>[0]) => real.layoutsFor(ctx, VIEW_LAYOUTS),
  };
});

import TypeView from '../../../src/renderer/lib/components/TypeView.svelte';
import { objectTypesStore } from '../../../src/renderer/lib/stores/object-types.svelte';

const PROJECT = {
  id: 'project', label: 'Project', classLocalName: 'Project', source: 'stock' as const,
  properties: [{ name: 'status', type: 'enum' as const, options: ['active', 'done'] }],
};
const ROWS = [{ path: 'a.md', title: 'Alpha', values: { status: 'active' }, cover: null }];
const props = () => ({
  typeId: 'project', layout: 'kanban' as const, sortColumn: null, sortDir: 'asc' as const, columns: null,
  revision: 0, onStateChange: vi.fn(), onOpenNote: vi.fn(),
});

beforeEach(async () => {
  h.list.mockResolvedValue({ types: [PROJECT], errors: [] });
  h.map.mockResolvedValue({});
  await objectTypesStore.refresh();
  h.instances.mockResolvedValue({ type: PROJECT, instances: ROWS });
});
afterEach(() => cleanup());

describe('a plugin-drawn layout with its plugin off (#2828)', () => {
  it('shows the table, says why in one line, and keeps the layout', async () => {
    h.on = false;
    const p = props();
    const { container } = render(TypeView, p);
    await screen.findByText('Alpha');
    expect(container.querySelector('.kb-column')).toBeNull();
    expect(container.querySelector('table')).not.toBeNull();
    expect(container.querySelector('.tv-layout-off')?.textContent).toBe(
      'Kanban is turned off on this machine. Turn on Kanban in Settings → Plugins to see this view that way.',
    );
    expect(p.onStateChange).not.toHaveBeenCalledWith(expect.objectContaining({ layout: expect.anything() }));
    const switcher = screen.getByRole('tablist', { name: 'View' });
    expect(within(switcher).getByRole('tab', { name: 'Table' })).toBeTruthy();
    expect(within(switcher).queryByRole('tab', { name: 'Kanban' })).toBeNull();
  });

  it('draws the layout, with no line, while the plugin is on', async () => {
    h.on = true;
    const { container } = render(TypeView, props());
    await screen.findByText('Alpha');
    expect(container.querySelector('.tv-layout-off')).toBeNull();
    expect(container.querySelector('.kb-column')).not.toBeNull();
    expect(within(screen.getByRole('tablist', { name: 'View' })).getByRole('tab', { name: 'Kanban' })).toBeTruthy();
  });
});
