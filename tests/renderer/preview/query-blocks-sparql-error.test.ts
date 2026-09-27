/**
 * @vitest-environment happy-dom
 *
 * A ` ```query ` block with malformed SPARQL shows the parser's message
 * (#2363). `graph:query` used to answer `{ results: [], columns: [], error }`,
 * and this path read only `results` — so a typo rendered as an empty list,
 * indistinguishable from a correct query that matched nothing. The SQL branch
 * already rendered its `{ ok: false }` arm; SPARQL now does the same.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ graphQuery: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { graph: { query: h.graphQuery } },
}));
vi.mock('../../../src/renderer/lib/charts', () => ({ renderChart: vi.fn() }));

import { executeQueryBlock, type QueryBlockDeps } from '../../../src/renderer/lib/preview/query-blocks';

function deps(): QueryBlockDeps {
  return { notePath: 'notes/cur.md', revision: 1, queryCache: new Map(), queryPrefixes: '', activeCharts: [] };
}

function block(query: string): HTMLElement {
  const el = document.createElement('div');
  el.dataset.type = 'list';
  el.dataset.query = query;
  return el;
}

beforeEach(() => { vi.clearAllMocks(); });

describe('SPARQL query block — failure arm (#2363)', () => {
  it('renders the parser error inline instead of an empty result list', async () => {
    h.graphQuery.mockResolvedValue({ ok: false, error: 'Parse error on line 1' });
    const el = block('SELEKT ?s');
    await executeQueryBlock(deps(), el);
    expect(el.innerHTML).toContain('query-error');
    expect(el.innerHTML).toContain('Parse error on line 1');
  });

  it('caches the failure for the same query text, like the SQL branch does', async () => {
    h.graphQuery.mockResolvedValue({ ok: false, error: 'Parse error on line 1' });
    const d = deps();
    await executeQueryBlock(d, block('SELEKT ?s'));
    const again = block('SELEKT ?s');
    await executeQueryBlock(d, again);
    expect(h.graphQuery).toHaveBeenCalledTimes(1);
    expect(again.innerHTML).toContain('Parse error on line 1');
  });

  it('still renders rows on the ok arm', async () => {
    h.graphQuery.mockResolvedValue({ ok: true, results: [{ s: 'notes/a.md' }], columns: ['s'] });
    const el = block('SELECT ?s WHERE { ?s ?p ?o }');
    await executeQueryBlock(deps(), el);
    expect(el.innerHTML).not.toContain('query-error');
    expect(el.innerHTML).toContain('query-result-list');
  });
});
