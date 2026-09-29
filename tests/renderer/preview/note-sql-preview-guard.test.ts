/**
 * @vitest-environment happy-dom
 *
 * The preview runs note-embedded SQL through the guarded channel (#2448).
 *
 * A vega-lite `data.sql` / `data.table` chart and a `:::query-*` block with
 * `language: sql` both run on preview with nobody pressing Run, and the note's
 * author is not necessarily the user. Main holds that SQL to registered tables
 * and views (`tables:queryNote` → `runNoteQuery`, pinned in
 * `tests/main/sources/note-sql-guard.test.ts`); this file pins the renderer
 * half — that the preview reaches for `queryNote`, NEVER the unguarded
 * `tables.query` the Query panel uses, and that a refusal renders in place.
 *
 * `tables.query` is wired to a mock that returns the canary, so a regression
 * back onto the unguarded channel shows the canary on screen and fails here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const CANARY = 'CANARY-2448-preview';
const REFUSAL =
  'Refused: the table function read_text() is not available to charts and query blocks in notes. ' +
  'Charts and query blocks in notes can only read the tables and views Minerva registered.';

const h = vi.hoisted(() => ({
  query: vi.fn(),
  queryNote: vi.fn(),
  graphQuery: vi.fn(),
  embed: vi.fn(),
}));

vi.mock('vega-embed', () => ({ default: h.embed }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: { graph: { query: h.graphQuery }, tables: { query: h.query, queryNote: h.queryNote } },
}));
vi.mock('../../../src/renderer/lib/theme', () => ({
  getEffectiveTheme: () => 'dark',
  getThemeMode: () => 'dark',
}));
vi.mock('../../../src/renderer/lib/charts', () => ({ renderChart: vi.fn() }));

import { executeQueryBlock, type QueryBlockDeps } from '../../../src/renderer/lib/preview/query-blocks';
import { hydrateVegaBlocks, _clearChartDataCacheForTests } from '../../../src/renderer/lib/markdown/vega-renderer';

const HOSTILE_SQL = "SELECT content FROM read_text('/tb/.minerva/secrets.json')";

function deps(): QueryBlockDeps {
  return { notePath: 'notes/shared.md', revision: 1, queryCache: new Map(), queryPrefixes: '', activeCharts: [] };
}

function sqlBlock(query: string, type = 'table'): HTMLElement {
  const el = document.createElement('div');
  el.dataset.type = type;
  el.dataset.query = query;
  el.dataset.config = JSON.stringify({ language: 'sql' });
  return el;
}

function chart(data: object): { root: HTMLElement; el: HTMLElement } {
  const root = document.createElement('div');
  const el = document.createElement('div');
  el.className = 'vega-block';
  el.textContent = JSON.stringify({
    mark: 'text',
    data,
    encoding: { text: { field: 'content', type: 'nominal' } },
  });
  root.appendChild(el);
  document.body.appendChild(root);
  return { root, el };
}

beforeEach(() => {
  vi.clearAllMocks();
  _clearChartDataCacheForTests();
  document.body.innerHTML = '';
  // The unguarded channel "reads the file". Nothing in the preview may use it.
  h.query.mockResolvedValue({ ok: true, columns: ['content'], rows: [{ content: CANARY }] });
  h.queryNote.mockResolvedValue({ ok: false, error: REFUSAL });
  h.embed.mockResolvedValue({ view: { finalize: vi.fn() }, finalize: vi.fn() });
});

describe('query block with language: sql (#2448)', () => {
  it('runs through tables.queryNote, never tables.query', async () => {
    await executeQueryBlock(deps(), sqlBlock(HOSTILE_SQL));
    expect(h.queryNote).toHaveBeenCalledWith(HOSTILE_SQL);
    expect(h.query).not.toHaveBeenCalled();
  });

  it('renders a refusal inline, with no content', async () => {
    const el = sqlBlock(HOSTILE_SQL);
    await executeQueryBlock(deps(), el);
    expect(el.innerHTML).toContain('query-error');
    expect(el.innerHTML).toContain('Charts and query blocks in notes can only read');
    expect(el.innerHTML).not.toContain(CANARY);
  });

  it('still renders rows from a registered table', async () => {
    h.queryNote.mockResolvedValue({ ok: true, columns: ['region'], rows: [{ region: 'north' }] });
    const el = sqlBlock('SELECT region FROM sales');
    await executeQueryBlock(deps(), el);
    expect(el.innerHTML).not.toContain('query-error');
    expect(el.innerHTML).toContain('query-result-table');
    expect(el.innerHTML).toContain('north');
  });

  it('a SPARQL block is unaffected (graph query, not SQL)', async () => {
    h.graphQuery.mockResolvedValue({ ok: true, results: [{ s: 'notes/a.md' }], columns: ['s'] });
    const el = document.createElement('div');
    el.dataset.type = 'list';
    el.dataset.query = 'SELECT ?s WHERE { ?s ?p ?o }';
    await executeQueryBlock(deps(), el);
    expect(h.graphQuery).toHaveBeenCalled();
    expect(h.queryNote).not.toHaveBeenCalled();
  });
});

describe('vega chart bound to SQL (#2448)', () => {
  it.each([
    ['data.sql', { sql: HOSTILE_SQL }, HOSTILE_SQL],
    ['data.table with a path', { table: '/tb/.minerva/secrets.json' }, 'SELECT * FROM "/tb/.minerva/secrets.json"'],
  ])('%s runs through tables.queryNote and renders the refusal in place', async (_name, data, sent) => {
    const { root, el } = chart(data);
    await hydrateVegaBlocks(root, '', 1);
    expect(h.queryNote).toHaveBeenCalledWith(sent);
    expect(h.query).not.toHaveBeenCalled();
    expect(h.embed).not.toHaveBeenCalled();
    expect(el.getAttribute('data-vega-rendered')).toBe('error');
    expect(el.innerHTML).toContain('Chart data unavailable');
    expect(el.innerHTML).toContain('Charts and query blocks in notes can only read');
    expect(el.innerHTML).not.toContain(CANARY);
  });

  it('a chart over a registered table still renders', async () => {
    h.queryNote.mockResolvedValue({ ok: true, columns: ['content'], rows: [{ content: 'north' }] });
    const { root, el } = chart({ sql: 'SELECT region AS content FROM sales' });
    await hydrateVegaBlocks(root, '', 1);
    expect(h.embed).toHaveBeenCalledTimes(1);
    expect(el.getAttribute('data-vega-rendered')).not.toBe('error');
    const spec = h.embed.mock.calls[0]![1] as { data: { values: unknown[] } };
    expect(spec.data.values).toEqual([{ content: 'north' }]);
  });
});
