/**
 * @vitest-environment happy-dom
 *
 * Objects-by-type sidebar (#1068): lists registry types with live instance
 * counts (zero-instance types visible), expands to instances via a graph
 * projection, and opens a note on click.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const { typesMock, queryMock } = vi.hoisted(() => ({ typesMock: vi.fn(), queryMock: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { types: { list: typesMock }, graph: { query: queryMock } },
}));

import ObjectsPanel from '../../../src/renderer/lib/components/ObjectsPanel.svelte';

const BOOK = { id: 'book', label: 'Book', classLocalName: 'Book', source: 'stock', icon: '📖', properties: [] };
const MEETING = { id: 'meeting', label: 'Meeting', classLocalName: 'Meeting', source: 'stock', icon: '🗓️', properties: [] };

beforeEach(() => {
  typesMock.mockResolvedValue({ types: [BOOK, MEETING], errors: [] });
  queryMock.mockImplementation((sparql: string) => {
    if (sparql.includes('thought:Excerpt')) return Promise.resolve({ results: [{ n: '7' }], columns: [] }); // excerpt count
    if (sparql.includes('COUNT')) return Promise.resolve({ results: [{ id: 'book', n: '2' }], columns: [] });
    if (sparql.includes('types:Book')) {
      return Promise.resolve({ results: [{ path: 'Dune.md', title: 'Dune' }, { path: 'Neuro.md', title: 'Neuromancer' }], columns: [] });
    }
    return Promise.resolve({ results: [], columns: [] });
  });
});
afterEach(() => { cleanup(); typesMock.mockReset(); queryMock.mockReset(); });

describe('ObjectsPanel (#1068)', () => {
  it('lists types with instance counts, including a zero-instance type', async () => {
    render(ObjectsPanel, { onFileSelect: vi.fn() });
    await waitFor(() => expect(screen.getByText('Book')).toBeTruthy());
    expect(screen.getByText('Meeting')).toBeTruthy(); // zero-instance, still shown
    expect(screen.getByText('2')).toBeTruthy(); // Book count
    expect(screen.getByText('0')).toBeTruthy(); // Meeting count
    expect(screen.getByText('Excerpts')).toBeTruthy(); // built-in Excerpts type (#1069)
    expect(screen.getByText('7')).toBeTruthy(); // excerpt count
  });

  it('expands a type to its instances and opens a note on click', async () => {
    const onFileSelect = vi.fn();
    render(ObjectsPanel, { onFileSelect });
    const bookRow = await screen.findByText('Book');
    await fireEvent.click(bookRow);
    const dune = await screen.findByText('Dune');
    expect(screen.getByText('Neuromancer')).toBeTruthy();
    await fireEvent.click(dune);
    expect(onFileSelect).toHaveBeenCalledWith('Dune.md');
  });

  it('shows an empty state for an expanded type with no instances', async () => {
    render(ObjectsPanel, { onFileSelect: vi.fn() });
    const meetingRow = await screen.findByText('Meeting');
    await fireEvent.click(meetingRow);
    await waitFor(() => expect(screen.getByText(/no meeting yet/i)).toBeTruthy());
  });
});
