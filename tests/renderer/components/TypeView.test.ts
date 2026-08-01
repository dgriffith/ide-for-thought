/**
 * @vitest-environment happy-dom
 *
 * Type multi-view (#1070): the same instance set rendered as list/table/gallery,
 * sortable table columns, a cover-keyed gallery, and deep-linking a row to its
 * note. The instance set comes once from api.types.instances — switching views
 * never re-queries.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const { instancesMock } = vi.hoisted(() => ({ instancesMock: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: { types: { instances: instancesMock } } }));

import TypeView from '../../../src/renderer/lib/components/TypeView.svelte';

const TYPE = {
  id: 'book',
  label: 'Book',
  classLocalName: 'Book',
  icon: '📖',
  source: 'stock' as const,
  properties: [
    { name: 'author', type: 'text' as const, label: 'Author' },
    { name: 'rating', type: 'number' as const, label: 'Rating' },
  ],
};
const INSTANCES = [
  { path: 'Dune.md', title: 'Dune', values: { author: 'Frank Herbert', rating: '5' }, cover: null },
  { path: 'Neuro.md', title: 'Neuromancer', values: { author: 'William Gibson', rating: '4' }, cover: null },
];

function props(over: Record<string, unknown> = {}) {
  return {
    typeId: 'book',
    layout: 'list' as const,
    revision: 0,
    onLayoutChange: vi.fn(),
    onOpenNote: vi.fn(),
    ...over,
  };
}

beforeEach(() => { instancesMock.mockResolvedValue({ type: TYPE, instances: INSTANCES }); });
afterEach(() => { cleanup(); instancesMock.mockReset(); });

describe('TypeView (#1070)', () => {
  it('renders the header (label + count) and a list of instances', async () => {
    render(TypeView, props({ layout: 'list' }));
    await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
    expect(screen.getByText('Neuromancer')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Book' })).toBeTruthy();
    expect(screen.getByText('2')).toBeTruthy(); // instance count
  });

  it('opens a note when an instance is clicked', async () => {
    const onOpenNote = vi.fn();
    render(TypeView, props({ layout: 'list', onOpenNote }));
    await fireEvent.click(await screen.findByText('Dune'));
    expect(onOpenNote).toHaveBeenCalledWith('Dune.md');
  });

  it('renders a column per declared property and sorts by a column', async () => {
    const { container } = render(TypeView, props({ layout: 'table' }));
    await waitFor(() => expect(screen.getByRole('columnheader', { name: /Author/ })).toBeTruthy());
    expect(screen.getByRole('columnheader', { name: /Rating/ })).toBeTruthy();

    const titles = () => [...container.querySelectorAll('tbody .tv-cell-title')].map((e) => e.textContent);
    expect(titles()).toEqual(['Dune', 'Neuromancer']); // intrinsic order

    // Sort by Rating asc: 4 (Neuromancer) before 5 (Dune).
    await fireEvent.click(screen.getByRole('columnheader', { name: /Rating/ }));
    await waitFor(() => expect(titles()).toEqual(['Neuromancer', 'Dune']));
    // Toggle to desc.
    await fireEvent.click(screen.getByRole('columnheader', { name: /Rating/ }));
    await waitFor(() => expect(titles()).toEqual(['Dune', 'Neuromancer']));
  });

  it('keys the gallery off the cover property, falling back to an icon card', async () => {
    instancesMock.mockResolvedValue({
      type: TYPE,
      instances: [
        { path: 'Widget.md', title: 'Widget', values: {}, cover: 'https://example.com/w.png' },
        { path: 'Gizmo.md', title: 'Gizmo', values: {}, cover: null },
      ],
    });
    const { container } = render(TypeView, props({ layout: 'gallery' }));
    await waitFor(() => expect(screen.getByText('Widget')).toBeTruthy());
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('https://example.com/w.png');
    expect(container.querySelectorAll('img')).toHaveLength(1); // Gizmo falls back to an icon, no img
  });

  it('switches views without re-querying the instance set', async () => {
    const onLayoutChange = vi.fn();
    render(TypeView, props({ layout: 'list', onLayoutChange }));
    await waitFor(() => expect(screen.getByText('Dune')).toBeTruthy());
    await fireEvent.click(screen.getByRole('tab', { name: 'Table' }));
    expect(onLayoutChange).toHaveBeenCalledWith('table');
    expect(instancesMock).toHaveBeenCalledTimes(1); // one load, not one per view
  });
});
