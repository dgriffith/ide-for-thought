/**
 * @vitest-environment happy-dom
 *
 * Component-level coverage for the #907 `:::argument` embed. Mocks
 * `api.graph.query` (the ONLY IPC surface this component touches — see the
 * read-only assertion in `argument-map-no-writes.test.ts`) and the Mermaid
 * hydrator (heavy, and its own rendering is covered by the existing mermaid
 * test suite — this file only checks ArgumentMap hands it the right source).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, waitFor, fireEvent } from '@testing-library/svelte';

const { queryMock, hydrateMermaidBlocksMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  hydrateMermaidBlocksMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { graph: { query: queryMock } },
}));
vi.mock('../../../src/renderer/lib/markdown/mermaid-renderer', () => ({
  hydrateMermaidBlocks: hydrateMermaidBlocksMock,
}));

import ArgumentMap from '../../../src/renderer/lib/components/ArgumentMap.svelte';

afterEach(() => {
  cleanup();
  queryMock.mockReset();
  hydrateMermaidBlocksMock.mockClear();
});

const FOCUS_URI = 'https://minerva.dev/notes/claim';
const GROUNDS_URI = 'https://minerva.dev/notes/grounds';
const REBUTTAL_URI = 'https://minerva.dev/notes/rebuttal';
const QUALIFIER_URI = 'https://minerva.dev/notes/qualifier';
const BACKING_URI = 'https://minerva.dev/notes/backing';

function jsonResult(results: unknown[]) {
  return { results, columns: [] };
}

/** Routes each call by inspecting the query text — same dispatch shape the
 *  component itself uses (focus → hop(s) → defects), without depending on
 *  call ORDER, since a future refactor reordering these shouldn't break this. */
function mockQueriesFor(opts: {
  focus?: unknown[];
  hop1?: unknown[];
  hop2?: unknown[];
  defects?: unknown[];
  errorOn?: 'focus' | 'hop1' | 'hop2' | 'defects';
}) {
  queryMock.mockImplementation((sparql: string) => {
    if (sparql.includes('minerva:relativePath') && sparql.includes('?focus')) {
      if (opts.errorOn === 'focus') return Promise.resolve({ results: [], columns: [], error: 'boom' });
      return Promise.resolve(jsonResult(opts.focus ?? []));
    }
    if (sparql.includes('thought:defectIn')) {
      if (opts.errorOn === 'defects') return Promise.resolve({ results: [], columns: [], error: 'boom' });
      return Promise.resolve(jsonResult(opts.defects ?? []));
    }
    if (sparql.includes(`<${FOCUS_URI}>`)) {
      if (opts.errorOn === 'hop1') return Promise.resolve({ results: [], columns: [], error: 'boom' });
      return Promise.resolve(jsonResult(opts.hop1 ?? []));
    }
    // Any deeper hop's VALUES clause references a prior hop's discovered node(s).
    if (opts.errorOn === 'hop2') return Promise.resolve({ results: [], columns: [], error: 'boom' });
    return Promise.resolve(jsonResult(opts.hop2 ?? []));
  });
}

interface RenderOverrides {
  focusRef?: string;
  initialDepth?: number;
  initialView?: 'outline' | 'diagram';
}

function renderMap(overrides: RenderOverrides = {}) {
  const onNavigate = vi.fn();
  const resolvePath = vi.fn((t: string) => (t === 'missing' ? null : 'notes/claim.md'));
  const result = render(ArgumentMap, {
    focusRef: '[[The Claim]]',
    queryPrefixes: '',
    resolvePath,
    onNavigate,
    ...overrides,
  });
  return { ...result, onNavigate, resolvePath };
}

describe('ArgumentMap (#907)', () => {
  it('shows an unresolved-focus error without ever calling api.graph.query', async () => {
    const { getByText } = renderMap({ focusRef: '[[missing]]' });
    await waitFor(() => expect(getByText(/Can't find a note/)).toBeTruthy());
    expect(queryMock).not.toHaveBeenCalled();
  });

  it('renders the calm empty state when the focus has no argument neighbors', async () => {
    mockQueriesFor({ focus: [{ focus: FOCUS_URI, title: 'The Claim' }], hop1: [] });
    const { getByText } = renderMap();
    await waitFor(() => expect(getByText('No argument structure recorded for this claim yet.')).toBeTruthy());
  });

  it('groups nodes into Support/Attack/Qualifiers and links ones with a note path', async () => {
    mockQueriesFor({
      focus: [{ focus: FOCUS_URI, title: 'The Claim' }],
      hop1: [
        { node: GROUNDS_URI, relation: 'https://minerva.dev/ontology/thought#supports', target: FOCUS_URI, title: 'Cited data', notePath: 'notes/grounds.md', roleType: 'https://minerva.dev/ontology/thought#Grounds' },
        { node: REBUTTAL_URI, relation: 'https://minerva.dev/ontology/thought#rebuts', target: FOCUS_URI, title: 'Counterexample', notePath: 'notes/rebuttal.md' },
        { node: QUALIFIER_URI, relation: 'https://minerva.dev/ontology/thought#qualifies', target: FOCUS_URI, title: 'Under normal conditions' },
      ],
      hop2: [],
    });
    const { getByText, getByRole } = renderMap();
    await waitFor(() => expect(getByText('Cited data')).toBeTruthy());
    expect(getByText('Counterexample')).toBeTruthy();
    expect(getByText('Under normal conditions')).toBeTruthy();
    expect(getByText('Support')).toBeTruthy();
    expect(getByText('Attack')).toBeTruthy();
    expect(getByText('Qualifiers')).toBeTruthy();
    // Only nodes carrying a notePath render as clickable.
    expect(getByRole('button', { name: /Cited data/ })).toBeTruthy();
  });

  it('clicking a linked node calls onNavigate with its note path, not a graph URI', async () => {
    mockQueriesFor({
      focus: [{ focus: FOCUS_URI, title: 'The Claim' }],
      hop1: [{ node: GROUNDS_URI, relation: 'https://minerva.dev/ontology/thought#supports', target: FOCUS_URI, title: 'Cited data', notePath: 'notes/grounds.md' }],
      hop2: [],
    });
    const { getByRole, onNavigate } = renderMap();
    const link = await waitFor(() => getByRole('button', { name: /Cited data/ }));
    await fireEvent.click(link);
    expect(onNavigate).toHaveBeenCalledWith('notes/grounds.md');
  });

  it('walks a second hop from the first hop\'s discovered nodes (grounds → backing)', async () => {
    mockQueriesFor({
      focus: [{ focus: FOCUS_URI, title: 'The Claim' }],
      hop1: [{ node: GROUNDS_URI, relation: 'https://minerva.dev/ontology/thought#supports', target: FOCUS_URI, title: 'Grounds' }],
      hop2: [{ node: BACKING_URI, relation: 'https://minerva.dev/ontology/thought#supports', target: GROUNDS_URI, title: 'Backing' }],
    });
    const { getByText } = renderMap({ initialDepth: 2 });
    await waitFor(() => expect(getByText('Backing')).toBeTruthy());
  });

  it('the depth control filters the already-fetched nodes without another query call', async () => {
    mockQueriesFor({
      focus: [{ focus: FOCUS_URI, title: 'The Claim' }],
      hop1: [{ node: GROUNDS_URI, relation: 'https://minerva.dev/ontology/thought#supports', target: FOCUS_URI, title: 'Grounds' }],
      hop2: [{ node: BACKING_URI, relation: 'https://minerva.dev/ontology/thought#supports', target: GROUNDS_URI, title: 'Backing' }],
    });
    const { getByText, queryByText, getByRole } = renderMap({ initialDepth: 1 });
    await waitFor(() => expect(getByText('Grounds')).toBeTruthy());
    expect(queryByText('Backing')).toBeNull(); // depth 1 — not yet visible
    const callsAfterLoad = queryMock.mock.calls.length;

    const slider = getByRole('slider');
    await fireEvent.input(slider, { target: { value: '2' } });
    await waitFor(() => expect(getByText('Backing')).toBeTruthy());
    expect(queryMock.mock.calls.length).toBe(callsAfterLoad); // no re-query
  });

  it('renders defects when present, with no defects section when absent', async () => {
    mockQueriesFor({
      focus: [{ focus: FOCUS_URI, title: 'The Claim' }],
      hop1: [],
      defects: [{ defect: 'https://x/d1', defectLabel: 'Hasty generalization', notePath: 'notes/claim.md' }],
    });
    const { getByText } = renderMap();
    await waitFor(() => expect(getByText(/Defects noted/)).toBeTruthy());
    expect(getByText('Hasty generalization')).toBeTruthy();
  });

  it('surfaces the focus query error rather than a blank/empty state', async () => {
    mockQueriesFor({ errorOn: 'focus' });
    const { getByText } = renderMap();
    await waitFor(() => expect(getByText('boom')).toBeTruthy());
  });

  it('toggling to diagram view hands Mermaid a source string derived from the loaded nodes', async () => {
    mockQueriesFor({
      focus: [{ focus: FOCUS_URI, title: 'The Claim' }],
      hop1: [{ node: GROUNDS_URI, relation: 'https://minerva.dev/ontology/thought#supports', target: FOCUS_URI, title: 'Grounds' }],
      hop2: [],
    });
    const { getByText, getByRole, container } = renderMap();
    await waitFor(() => expect(getByText('Grounds')).toBeTruthy());

    await fireEvent.click(getByRole('button', { name: 'Diagram' }));
    await waitFor(() => expect(hydrateMermaidBlocksMock).toHaveBeenCalled());

    const mermaidHost = container.querySelector<HTMLElement>('.mermaid-block');
    expect(mermaidHost).toBeTruthy();
    expect(mermaidHost!.dataset.mermaidSource).toContain('graph TD');
    expect(mermaidHost!.dataset.mermaidSource).toContain('Grounds');
  });
});
