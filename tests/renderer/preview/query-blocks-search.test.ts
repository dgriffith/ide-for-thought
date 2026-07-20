/**
 * @vitest-environment happy-dom
 *
 * Dispatch wiring for the `:::query-search` block — `executeQueryBlock` reads
 * the placeholder's type/query, hits `api.search.query` (the MiniSearch index),
 * excludes the current note, and injects the rendered list. Mocks the IPC + the
 * heavy chart/link-bundle imports so only the search path runs.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({ api: { search: { query: h.query } } }));
vi.mock('../../../src/renderer/lib/charts', () => ({ renderChart: vi.fn() }));
vi.mock('../../../src/renderer/lib/sidebar-link-bundle', () => ({ getLinkBundle: vi.fn() }));

import { executeQueryBlock, type QueryBlockDeps } from '../../../src/renderer/lib/preview/query-blocks';

function deps(over: Partial<QueryBlockDeps> = {}): QueryBlockDeps {
  return { notePath: 'notes/cur.md', revision: 0, queryCache: new Map(), queryPrefixes: '', activeCharts: [], ...over };
}
function block(type: string, query: string): HTMLElement {
  const el = document.createElement('div');
  el.dataset.type = type;
  el.dataset.query = query;
  return el;
}

beforeEach(() => vi.clearAllMocks());

describe('executeQueryBlock — search branch', () => {
  it('queries the index and renders ranked links, excluding the current note', async () => {
    h.query.mockResolvedValue([
      { relativePath: 'notes/cur.md', title: 'Self', snippet: 's', score: 9 },
      { relativePath: 'notes/raft.md', title: 'Raft', snippet: 'consensus', score: 7 },
    ]);
    const el = block('search', 'raft');
    await executeQueryBlock(deps(), el);
    expect(h.query).toHaveBeenCalledWith('raft');
    expect(el.innerHTML).toContain('data-target="notes/raft.md"');
    expect(el.innerHTML).toContain('consensus');
    expect(el.innerHTML).not.toContain('notes/cur.md'); // self-excluded
  });

  it('renders the empty state on a blank query without hitting IPC', async () => {
    const el = block('search', '   ');
    await executeQueryBlock(deps(), el);
    expect(h.query).not.toHaveBeenCalled();
    expect(el.innerHTML).toContain('No matches');
  });

  it('falls back to the empty state when the query throws', async () => {
    h.query.mockRejectedValue(new Error('boom'));
    const el = block('search', 'x');
    await executeQueryBlock(deps(), el);
    expect(el.innerHTML).toContain('No matches');
  });
});
