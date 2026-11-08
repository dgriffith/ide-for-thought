/**
 * @vitest-environment happy-dom
 *
 * A query view's header names its source (#2948): a saved query's file,
 * which opens it in the Query panel (plugin queries too — they're read
 * there, never written), or "Inline query", which shows its text.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, screen, waitFor } from '@testing-library/svelte';

const h = vi.hoisted(() => ({ list: vi.fn(), openQuery: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: { queries: { list: h.list } } }));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', () => ({ getEditorStore: () => ({ openQuery: h.openQuery }) }));

import TypeViewQuerySource from '../../../src/renderer/lib/components/TypeViewQuerySource.svelte';
import { queryFileName } from '../../../src/shared/views/view-source-spec';

const Q = 'SELECT ?note WHERE { ?note a minerva:Note }';
beforeEach(() => {
  h.list.mockResolvedValue([
    { id: '1', name: 'overdue', description: '', query: Q, language: 'sparql', scope: 'project', filePath: '/tb/.minerva/queries/overdue.rq', group: null, order: null },
    { id: '2', name: 'Shelf', description: '', query: 'SELECT 1', language: 'sql', scope: 'plugin', plugin: { id: 'p', name: 'P', version: '1.0.0' }, filePath: 'C:\\\\Users\\\\a\\\\plugins\\\\p\\\\queries\\\\shelf.sql', group: null, order: null },
  ]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('the view header\'s source (#2948)', () => {
  it('a saved query names its file, and a click opens it in the Query panel', async () => {
    render(TypeViewQuerySource, { spec: { kind: 'queryFile', queryFile: 'overdue.rq' } });
    await fireEvent.click(screen.getByRole('button', { name: 'overdue.rq' }));
    await waitFor(() => expect(h.openQuery).toHaveBeenCalledWith(Q, 'sparql'));
  });

  it('a plugin\'s read-only query opens too; one that isn\'t there says so', async () => {
    render(TypeViewQuerySource, { spec: { kind: 'queryFile', queryFile: 'shelf.sql' } });
    await fireEvent.click(screen.getByRole('button', { name: 'shelf.sql' }));
    await waitFor(() => expect(h.openQuery).toHaveBeenCalledWith('SELECT 1', 'sql'));
    cleanup();
    render(TypeViewQuerySource, { spec: { kind: 'queryFile', queryFile: 'gone.rq' } });
    await fireEvent.click(screen.getByRole('button', { name: 'gone.rq' }));
    expect(await screen.findByText('(not found)')).toBeTruthy();
  });

  it('an inline query is named so, and shows its text on request', async () => {
    const { container } = render(TypeViewQuerySource, { spec: { kind: 'query', query: Q, language: 'sparql' } });
    const btn = screen.getByRole('button', { name: 'Inline query' });
    expect(btn.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('pre')).toBeNull();
    await fireEvent.click(btn);
    expect(container.querySelector('pre')!.textContent).toBe(Q);
  });

  it('a query file is named by its path\'s last segment, either separator', () => {
    expect(queryFileName('/tb/.minerva/queries/overdue.rq')).toBe('overdue.rq');
    expect(queryFileName('C:\\\\q\\\\shelf.sql')).toBe('shelf.sql');
  });
});
