/**
 * @vitest-environment happy-dom
 *
 * Excerpts browser (#1069): lists thought:Excerpt with source, narrows by the
 * source/tag/citing-note filters, and opens an excerpt on click.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: { graph: { query: queryMock } } }));

import ExcerptsBrowser from '../../../src/renderer/lib/components/ExcerptsBrowser.svelte';

const ALL = [
  { id: 'smith-2023-a', text: 'Being precedes essence.', srcTitle: 'Smith 2023' },
  { id: 'jones-2024-a', text: 'Nothing is fixed.', srcTitle: 'Jones 2024' },
];
const SMITH_ONLY = [ALL[0]];

beforeEach(() => {
  queryMock.mockImplementation((sparql: string) => {
    if (sparql.includes('DISTINCT ?src')) return Promise.resolve({ results: [{ src: 'smith-2023', title: 'Smith 2023' }], columns: [] });
    if (sparql.includes('DISTINCT ?tag')) return Promise.resolve({ results: [{ tag: 'philosophy' }], columns: [] });
    if (sparql.includes('DISTINCT ?path')) return Promise.resolve({ results: [{ path: 'Argument.md', title: 'Argument' }], columns: [] });
    // the excerpt list
    const filtered = /sourceId "|tagName "|relativePath "/.test(sparql);
    return Promise.resolve({ results: filtered ? SMITH_ONLY : ALL, columns: [] });
  });
});
afterEach(() => { cleanup(); queryMock.mockReset(); });

describe('ExcerptsBrowser (#1069)', () => {
  it('lists all excerpts with their source', async () => {
    render(ExcerptsBrowser, { onOpenExcerpt: vi.fn() });
    await waitFor(() => expect(screen.getByText(/Being precedes essence/)).toBeTruthy());
    expect(screen.getByText(/Nothing is fixed/)).toBeTruthy();
    expect(screen.getAllByText('Smith 2023').length).toBeGreaterThan(0); // option + source label
  });

  it('wires up the source / tag / citing-note filters', async () => {
    // Query correctness for the filter constraints is covered by the graph test
    // (excerpts-browser.test.ts); here we verify the options load + render.
    render(ExcerptsBrowser, { onOpenExcerpt: vi.fn() });
    await waitFor(() => expect(screen.getByText(/Being precedes essence/)).toBeTruthy());
    const sparqls = queryMock.mock.calls.map((c) => String(c[0]));
    expect(sparqls.some((s) => s.includes('DISTINCT ?src'))).toBe(true);
    expect(sparqls.some((s) => s.includes('DISTINCT ?tag'))).toBe(true);
    expect(sparqls.some((s) => s.includes('DISTINCT ?path'))).toBe(true);
    await waitFor(() => expect(screen.getByRole('option', { name: /Smith 2023/ })).toBeTruthy());
    expect(screen.getByRole('option', { name: /philosophy/ })).toBeTruthy();
  });

  it('opens an excerpt on click', async () => {
    const onOpenExcerpt = vi.fn();
    render(ExcerptsBrowser, { onOpenExcerpt });
    const row = await screen.findByText(/Being precedes essence/);
    await fireEvent.click(row);
    expect(onOpenExcerpt).toHaveBeenCalledWith('smith-2023-a');
  });
});
