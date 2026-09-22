/**
 * @vitest-environment happy-dom
 *
 * Live query blocks answer once per graph revision, not once per render tick
 * (#2210 §3c).
 *
 * The preview re-renders on a 120ms debounce while you type, and the
 * post-render effect walks every `.query-block` and calls `executeQueryBlock`
 * on it. Three families of block live there, and until this change they had
 * three different caching stories:
 *
 *   - `backlinks` went through `getLinkBundle(notePath, revision)`, memoized
 *     on the revision — correct and cheap;
 *   - `sparql` / `sql` went through `deps.queryCache`, keyed on the query text;
 *   - `search` and `semantic` `return`ed ABOVE the `queryCache` lookup and so
 *     re-issued their IPC call on every single tick.
 *
 * The last one is the expensive one. A `semantic` block with a free-text body
 * calls `api.embeddings.searchText`, which runs the embedding model over the
 * query string — roughly eight times a second while typing, for a string that
 * has not changed.
 *
 * The gates below are CALL COUNTS, not timings (#2229's scope note). "Eight
 * renders issue one search" is the invariant and it is exact; a millisecond
 * threshold on a shared runner is not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  search: vi.fn(),
  searchText: vi.fn(),
  related: vi.fn(),
  getLinkBundle: vi.fn(),
}));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    search: { query: h.search },
    embeddings: { searchText: h.searchText, related: h.related },
  },
}));
vi.mock('../../../src/renderer/lib/charts', () => ({ renderChart: vi.fn() }));
vi.mock('../../../src/renderer/lib/sidebar-link-bundle', () => ({ getLinkBundle: h.getLinkBundle }));

import { executeQueryBlock, type QueryBlockDeps } from '../../../src/renderer/lib/preview/query-blocks';

/** One Preview instance's shared state — the cache survives re-renders. */
function previewState(): { cache: QueryBlockDeps['queryCache']; deps: (rev: number) => QueryBlockDeps } {
  const cache: QueryBlockDeps['queryCache'] = new Map();
  return {
    cache,
    deps: (revision: number) => ({
      notePath: 'notes/cur.md',
      revision,
      queryCache: cache,
      queryPrefixes: '',
      activeCharts: [],
    }),
  };
}

/** A fresh placeholder each tick — the `{@html}` swap rebuilds the DOM. */
function block(type: string, query: string, config?: Record<string, string>): HTMLElement {
  const el = document.createElement('div');
  el.dataset.type = type;
  el.dataset.query = query;
  if (config) el.dataset.config = JSON.stringify(config);
  return el;
}

beforeEach(() => {
  vi.clearAllMocks();
  h.search.mockResolvedValue([{ relativePath: 'notes/raft.md', title: 'Raft', snippet: 's', score: 7 }]);
  h.searchText.mockResolvedValue({
    enabled: true,
    notes: [{ kind: 'note', ref: 'notes/raft.md', title: 'Raft', sectionHeading: '', snippet: 'consensus', score: 0.9 }],
  });
  h.related.mockResolvedValue({
    enabled: true,
    notes: [{ kind: 'note', ref: 'notes/b.md', title: 'B', sectionHeading: '', snippet: 'b', score: 0.8 }],
  });
});

describe('semantic block (#2210 §3c)', () => {
  it('re-embeds the query ONCE across eight render ticks', async () => {
    // The headline. Eight ticks is about one second of typing.
    const s = previewState();
    for (let tick = 0; tick < 8; tick++) {
      await executeQueryBlock(s.deps(3), block('semantic', 'consensus protocols'));
    }
    expect(h.searchText, 'the render tick re-embedded the query').toHaveBeenCalledTimes(1);
  });

  it('every tick still renders the results, not a stale loading state', async () => {
    // The count gate above is satisfied by a block that renders nothing after
    // the first tick. Each fresh placeholder must end up populated.
    const s = previewState();
    for (let tick = 0; tick < 4; tick++) {
      const el = block('semantic', 'consensus protocols');
      await executeQueryBlock(s.deps(3), el);
      expect(el.innerHTML, `tick ${tick} left the block unrendered`).toContain('notes/raft.md');
      expect(el.innerHTML).not.toContain('query-loading');
    }
  });

  it('a graph change re-embeds — the block is still live', async () => {
    // Why `revision` is IN the key rather than a reason to clear the cache:
    // #1128's promise is that this block reflects embeddings added elsewhere.
    const s = previewState();
    await executeQueryBlock(s.deps(3), block('semantic', 'consensus protocols'));
    await executeQueryBlock(s.deps(3), block('semantic', 'consensus protocols'));
    expect(h.searchText).toHaveBeenCalledTimes(1);

    await executeQueryBlock(s.deps(4), block('semantic', 'consensus protocols'));
    expect(h.searchText, 'a graph revision did not refresh the block').toHaveBeenCalledTimes(2);
  });

  it('a different kinds filter is a different query, not a cache hit', async () => {
    // The block's `kind` config becomes the `kinds` ARGUMENT to searchText,
    // so it has to be in the key. Sharing one entry across filters would show
    // excerpt results in a notes-only block.
    const s = previewState();
    await executeQueryBlock(s.deps(1), block('semantic', 'raft', { kind: 'note' }));
    await executeQueryBlock(s.deps(1), block('semantic', 'raft', { kind: 'excerpt' }));
    expect(h.searchText).toHaveBeenCalledTimes(2);
  });

  it('a post-hoc config change re-selects without re-embedding', async () => {
    // `threshold` filters the returned rows; it is not an argument to the IPC
    // call, so it is deliberately NOT in the key. Caching raw rows rather than
    // rendered HTML is what makes that work.
    const s = previewState();
    await executeQueryBlock(s.deps(1), block('semantic', 'raft', { kind: 'note' }));
    const el = block('semantic', 'raft', { kind: 'note', threshold: '0.95' });
    await executeQueryBlock(s.deps(1), el);
    expect(h.searchText).toHaveBeenCalledTimes(1);
    expect(el.innerHTML, 'the raised threshold did not filter the cached rows')
      .not.toContain('notes/raft.md');
  });

  it('the empty-body form caches its related() call too', async () => {
    const s = previewState();
    for (let tick = 0; tick < 5; tick++) {
      await executeQueryBlock(s.deps(2), block('semantic', ''));
    }
    expect(h.related).toHaveBeenCalledTimes(1);
  });

  it('a failed embed is NOT cached — the next tick retries', async () => {
    // Freezing a transient IPC failure into the block until the next save
    // would be a worse bug than the one this file fixes.
    const s = previewState();
    h.searchText.mockRejectedValueOnce(new Error('preload not reloaded'));
    await executeQueryBlock(s.deps(1), block('semantic', 'raft'));
    const el = block('semantic', 'raft');
    await executeQueryBlock(s.deps(1), el);
    expect(h.searchText).toHaveBeenCalledTimes(2);
    expect(el.innerHTML).toContain('notes/raft.md');
  });
});

describe('search block (#2210 §3c)', () => {
  it('queries the index ONCE across eight render ticks', async () => {
    const s = previewState();
    for (let tick = 0; tick < 8; tick++) {
      await executeQueryBlock(s.deps(1), block('search', 'raft'));
    }
    expect(h.search, 'the render tick re-queried the search index').toHaveBeenCalledTimes(1);
  });

  it('every tick still renders the results', async () => {
    const s = previewState();
    for (let tick = 0; tick < 4; tick++) {
      const el = block('search', 'raft');
      await executeQueryBlock(s.deps(1), el);
      expect(el.innerHTML, `tick ${tick} left the block unrendered`).toContain('notes/raft.md');
    }
  });

  it('a graph change re-queries', async () => {
    const s = previewState();
    await executeQueryBlock(s.deps(1), block('search', 'raft'));
    await executeQueryBlock(s.deps(2), block('search', 'raft'));
    expect(h.search).toHaveBeenCalledTimes(2);
  });

  it('editing the query text re-queries', async () => {
    const s = previewState();
    await executeQueryBlock(s.deps(1), block('search', 'raft'));
    await executeQueryBlock(s.deps(1), block('search', 'paxos'));
    expect(h.search).toHaveBeenCalledTimes(2);
  });
});

describe('cache growth', () => {
  it('does not accumulate an entry per revision', async () => {
    // Each save bumps the revision. Without pruning, a long editing session
    // would leave one entry per block per save and release none of them —
    // trading a CPU leak for a memory one.
    const s = previewState();
    for (let rev = 0; rev < 40; rev++) {
      await executeQueryBlock(s.deps(rev), block('semantic', 'raft'));
      await executeQueryBlock(s.deps(rev), block('search', 'raft'));
    }
    expect(s.cache.size, `cache grew to ${s.cache.size} entries over 40 revisions`)
      .toBeLessThanOrEqual(2);
  });

  it('leaves the SPARQL/SQL entries alone while pruning live ones', async () => {
    // Those are keyed on query text, not revision, and are already bounded by
    // the number of distinct queries in the note. Pruning them would reinstate
    // the per-tick re-query for a different family of block.
    const s = previewState();
    s.cache.set('sparql::SELECT * WHERE {}', { results: [{ x: '1' }] });
    for (let rev = 0; rev < 5; rev++) {
      await executeQueryBlock(s.deps(rev), block('semantic', 'raft'));
    }
    expect(s.cache.has('sparql::SELECT * WHERE {}'), 'pruning evicted a non-live entry').toBe(true);
  });
});
