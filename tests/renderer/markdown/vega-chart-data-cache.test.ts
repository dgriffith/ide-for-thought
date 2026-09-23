/**
 * @vitest-environment happy-dom
 *
 * A chart re-runs its backing query once per graph revision, not once per
 * render tick (#2210 §3c).
 *
 * `hydrateVegaBlocks` carries an idempotence guard — it selects
 * `.vega-block:not([data-vega-rendered])` — and that guard is written as an
 * attribute on the placeholder element. `Preview.svelte` renders through
 * `{@html rendered}`, which replaces the whole subtree on every 120ms render
 * tick, so each tick presents a brand-new element with no attribute on it. The
 * guard is never false. It is simply never asked, because the element it was
 * written on no longer exists.
 *
 * What that costs: a `data.sparql` chart re-ran a full SPARQL query over the
 * graph, over IPC, roughly eight times a second while typing. A `data.sql` /
 * `data.table` chart re-ran a DuckDB query — #2228 measured one of those at
 * 1.9s and a 99.8MB structured clone for a million-row table.
 *
 * The gates here are CALL COUNTS (#2229's scope note). Every test drives the
 * real `hydrateVegaBlocks` with a fresh placeholder per tick, which is exactly
 * what the `{@html}` swap produces — asserting against a reused element would
 * test the guard that already worked rather than the situation it fails in.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  graphQuery: vi.fn(),
  tablesQuery: vi.fn(),
  embed: vi.fn(),
}));

vi.mock('vega-embed', () => ({ default: h.embed }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { graph: { query: h.graphQuery }, tables: { query: h.tablesQuery } },
}));
vi.mock('../../../src/renderer/lib/theme', () => ({
  getEffectiveTheme: () => 'dark',
  getThemeMode: () => 'dark',
}));

import {
  hydrateVegaBlocks,
  _clearChartDataCacheForTests,
} from '../../../src/renderer/lib/markdown/vega-renderer';

/** A fresh root + placeholder, the way the `{@html}` swap rebuilds them. */
function tick(spec: object): HTMLElement {
  const root = document.createElement('div');
  const el = document.createElement('div');
  el.className = 'vega-block';
  el.textContent = JSON.stringify(spec);
  root.appendChild(el);
  document.body.appendChild(root);
  return root;
}

const sparqlSpec = { mark: 'bar', data: { sparql: 'SELECT ?s WHERE { ?s ?p ?o }' } };
const sqlSpec = { mark: 'bar', data: { sql: 'SELECT * FROM t' } };
const tableSpec = { mark: 'bar', data: { table: 'readings' } };

beforeEach(() => {
  vi.clearAllMocks();
  _clearChartDataCacheForTests();
  document.body.innerHTML = '';
  h.graphQuery.mockResolvedValue({ results: [{ s: 'a' }, { s: 'b' }] });
  h.tablesQuery.mockResolvedValue({ ok: true, columns: ['a'], rows: [{ a: 1 }] });
  // vega-embed is mocked to a no-op view; this file is about what happens
  // BEFORE the embed, and loading the real library here would pull megabytes.
  h.embed.mockResolvedValue({ view: { finalize: vi.fn() }, finalize: vi.fn() });
});

describe('sparql-bound chart (#2210 §3c)', () => {
  it('queries the graph ONCE across eight render ticks', async () => {
    for (let i = 0; i < 8; i++) await hydrateVegaBlocks(tick(sparqlSpec), '', 5);
    expect(h.graphQuery, 'the render tick re-ran the chart query').toHaveBeenCalledTimes(1);
  });

  it('every tick still reaches the embed with resolved data', async () => {
    // The count gate above is satisfied by a chart that silently stops
    // rendering after tick one. Each fresh placeholder must get a spec with
    // inline values, resolved from the cache on the later ticks.
    for (let i = 0; i < 4; i++) await hydrateVegaBlocks(tick(sparqlSpec), '', 5);
    expect(h.embed).toHaveBeenCalledTimes(4);
    for (const call of h.embed.mock.calls) {
      const spec = call[1] as { data?: { values?: unknown[] } };
      expect(spec.data?.values, 'a tick embedded a spec with no resolved rows').toHaveLength(2);
    }
  });

  it('a graph change re-runs the query', async () => {
    await hydrateVegaBlocks(tick(sparqlSpec), '', 5);
    await hydrateVegaBlocks(tick(sparqlSpec), '', 5);
    expect(h.graphQuery).toHaveBeenCalledTimes(1);
    await hydrateVegaBlocks(tick(sparqlSpec), '', 6);
    expect(h.graphQuery, 'a save did not refresh the chart').toHaveBeenCalledTimes(2);
  });

  it('a different query is not a cache hit', async () => {
    await hydrateVegaBlocks(tick(sparqlSpec), '', 5);
    await hydrateVegaBlocks(tick({ mark: 'bar', data: { sparql: 'SELECT ?x WHERE { ?x a ?y }' } }), '', 5);
    expect(h.graphQuery).toHaveBeenCalledTimes(2);
  });

  it('a failed query is NOT cached — the next tick retries', async () => {
    // Freezing a transient query failure into the chart until the next save
    // would replace a performance bug with a correctness one.
    h.graphQuery.mockResolvedValueOnce({ error: 'bad SPARQL' });
    await hydrateVegaBlocks(tick(sparqlSpec), '', 5);
    await hydrateVegaBlocks(tick(sparqlSpec), '', 5);
    expect(h.graphQuery).toHaveBeenCalledTimes(2);
  });
});

describe('sql- and table-bound charts', () => {
  it('a data.sql chart runs its DuckDB query once per revision', async () => {
    for (let i = 0; i < 6; i++) await hydrateVegaBlocks(tick(sqlSpec), '', 2);
    expect(h.tablesQuery).toHaveBeenCalledTimes(1);
  });

  it('a data.table chart does too, keyed on the table name', async () => {
    for (let i = 0; i < 3; i++) await hydrateVegaBlocks(tick(tableSpec), '', 2);
    await hydrateVegaBlocks(tick({ mark: 'bar', data: { table: 'other' } }), '', 2);
    expect(h.tablesQuery).toHaveBeenCalledTimes(2);
  });

  it('a sql and a sparql binding with identical text do not collide', async () => {
    const text = 'SELECT * FROM t';
    await hydrateVegaBlocks(tick({ mark: 'bar', data: { sql: text } }), '', 1);
    await hydrateVegaBlocks(tick({ mark: 'bar', data: { sparql: text } }), '', 1);
    expect(h.tablesQuery).toHaveBeenCalledTimes(1);
    expect(h.graphQuery).toHaveBeenCalledTimes(1);
  });
});

describe('cell-bound charts are deliberately not cached', () => {
  it('re-reads the note source each tick', async () => {
    // A `data.cell` binding reads a compute cell's output out of the note's
    // own markdown — a local string scan with no IPC, whose input is the very
    // thing that changes on the keystrokes this cache exists to absorb.
    // Caching it against `revision` would show the previous output until save.
    const spec = { mark: 'bar', data: { cell: 'aaaa1111' } };
    // An `output` fence directly after the cell's closing fence — the shape
    // `findAdjacentOutputBlock` accepts (at most one blank line between).
    const withRows = (v: number) =>
      '```sql {id=aaaa1111}\nSELECT 1\n```\n'
      + '```output\n' + JSON.stringify({ type: 'table', columns: ['n'], rows: [[v]] }) + '\n```\n';

    await hydrateVegaBlocks(tick(spec), withRows(1), 7);
    await hydrateVegaBlocks(tick(spec), withRows(2), 7);

    const specs = h.embed.mock.calls.map((c) => c[1] as { data?: { values?: { n?: number }[] } });
    expect(specs).toHaveLength(2);
    expect(
      specs[1]?.data?.values?.[0]?.n,
      'a cell-bound chart served a stale value from the cache',
    ).not.toBe(specs[0]?.data?.values?.[0]?.n);
  });
});

describe('cache growth', () => {
  it('does not accumulate one entry per revision', async () => {
    // A chart's cached value is a whole query result, so an unbounded leak
    // here is measured in megabytes, not kilobytes. Forty saves must not
    // leave forty result sets resident.
    for (let rev = 0; rev < 40; rev++) {
      await hydrateVegaBlocks(tick(sparqlSpec), '', rev);
    }
    expect(h.graphQuery).toHaveBeenCalledTimes(40); // each revision is a real refresh

    // With pruning, only the newest revision's entry survives — so re-running
    // an OLD revision must miss.
    const before = h.graphQuery.mock.calls.length;
    await hydrateVegaBlocks(tick(sparqlSpec), '', 0);
    expect(h.graphQuery.mock.calls.length, 'an evicted revision was still cached')
      .toBe(before + 1);
  });
});
