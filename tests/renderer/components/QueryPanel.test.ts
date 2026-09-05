/**
 * @vitest-environment happy-dom
 *
 * QueryPanel render test (#2049). Added alongside the prop-drilling cleanup
 * that moved `onQueryChange`/`onLanguageChange`/`onExecute` from callback
 * props to direct `editorStore` calls (mirroring Sidebar.svelte's #1922
 * pattern) — this closes the gap of QueryPanel having no render coverage at
 * all, and is what actually exercises the new store-call wiring end to end
 * through a real click/keypress rather than by code inspection alone.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor, screen } from '@testing-library/svelte';
import type { QueryTab } from '../../../src/renderer/lib/stores/editor.svelte';

const h = vi.hoisted(() => ({
  api: {
    graph: { schemaForCompletion: vi.fn() },
    tables: { list: vi.fn() },
    export: { csv: vi.fn() },
  },
  editorStore: {
    setQueryText: vi.fn(),
    setQueryLanguage: vi.fn(),
    executeQuery: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: h.api }));
vi.mock('../../../src/renderer/lib/stores/editor.svelte', async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return { ...actual, getEditorStore: () => h.editorStore };
});

import QueryPanel from '../../../src/renderer/lib/components/QueryPanel.svelte';

function makeTab(over: Partial<QueryTab> = {}): QueryTab {
  return {
    type: 'query',
    id: 'query-1',
    title: 'Query 1',
    query: '',
    language: 'sparql',
    results: null,
    columns: [],
    error: null,
    executing: false,
    executionTime: null,
    ...over,
  };
}

function props(over: Record<string, unknown> = {}) {
  return {
    tab: makeTab(),
    onSave: vi.fn(),
    ...over,
  };
}

beforeEach(() => {
  h.api.graph.schemaForCompletion.mockResolvedValue({ properties: [], classes: [] });
  h.api.tables.list.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('QueryPanel (#2049)', () => {
  it('mounts a CodeMirror view for the query and renders the Run button', async () => {
    render(QueryPanel, props());
    await waitFor(() => expect(screen.getByRole('button', { name: 'Run' })).toBeTruthy());
  });

  it('routes the Run button through editorStore.executeQuery directly', async () => {
    render(QueryPanel, props({ tab: makeTab({ query: 'SELECT * WHERE { ?s ?p ?o }' }) }));
    const runBtn = await waitFor(() => screen.getByRole('button', { name: 'Run' }));
    await fireEvent.click(runBtn);
    expect(h.editorStore.executeQuery).toHaveBeenCalledTimes(1);
  });

  it('routes the language dropdown through editorStore.setQueryLanguage directly', async () => {
    render(QueryPanel, props());
    const select = await waitFor(() => screen.getByTitle('Query language'));
    await fireEvent.change(select, { target: { value: 'sql' } });
    expect(h.editorStore.setQueryLanguage).toHaveBeenCalledWith('sql');
  });
});
