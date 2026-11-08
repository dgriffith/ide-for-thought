/**
 * @vitest-environment happy-dom
 *
 * A query block rendered for export (#2512) runs the preview's own code path —
 * the same prefixes, the same guarded SQL route, the same builders — and its
 * result links come out as links the export resolves. A `:::query-list` /
 * `:::query-table` is a query view since #2947: its export is the view's,
 * through `queryViews.rows` (SQL under the note guard, in main).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ graphQuery: vi.fn(), queryNote: vi.fn(), tablesQuery: vi.fn(), searchQuery: vi.fn(), rows: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    graph: { query: h.graphQuery },
    tables: { queryNote: h.queryNote, query: h.tablesQuery },
    search: { query: h.searchQuery },
    embeddings: { related: vi.fn(), searchText: vi.fn() },
    queryViews: { rows: h.rows },
    types: { instances: vi.fn(), list: async () => ({ types: [], errors: [] }), noteTypeMap: async () => ({}) },
    app: { getSystemLocale: async () => 'en-GB' },
  },
}));

import { renderQueryBlockForExport } from '../../../src/renderer/lib/export/render-query-block';
import { renderLiveBlock } from '../../../src/renderer/lib/app/export-live-blocks';

const ROWS = [
  { path: 'trip/places/Kampa Museum.md', title: 'Kampa Museum', city: 'Prague' },
  { path: 'trip/places/Széchenyi.md', title: 'Széchenyi Baths', city: 'Budapest' },
];

const VIEW_ROWS = ROWS.map((r) => ({ path: r.path, title: r.title, values: { city: r.city } }));

beforeEach(() => {
  h.rows.mockResolvedValue({ ok: true, schema: { columns: [{ name: 'city', type: 'text' }], noteColumn: 'path' }, rows: VIEW_ROWS, truncated: false });
  h.graphQuery.mockResolvedValue({ ok: true, results: ROWS });
  h.queryNote.mockResolvedValue({ ok: true, columns: ['path', 'title'], rows: [['trip/places/Kampa Museum.md', 'Kampa Museum']] });
});
afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); });

describe('renderQueryBlockForExport', () => {
  it('a list is a query view: its query run as one, its title, each note linked (#2947)', async () => {
    const html = await renderQueryBlockForExport(':::query-list\ntitle: Places\n---\nSELECT ?path ?title WHERE { ?n ?p ?o }\n:::', 'trip/plan.md');
    expect(h.rows).toHaveBeenCalledWith('SELECT ?path ?title WHERE { ?n ?p ?o }', 'sparql', { note: undefined, columns: undefined });
    expect(html).toContain('<h4 class="query-title">Places</h4>');
    expect(html).toContain('class="minerva-live-block"');
    expect(html).toContain('data-note-link="trip/places/Kampa Museum.md"');
    expect(html).toContain('data-note-link="trip/places/Széchenyi.md"');
    expect(html).toContain('Széchenyi Baths');
    expect(html).not.toContain('Loading');
  });

  it('a table is the view\'s table: its columns, its rows, linked; `link` and `columns` honoured', async () => {
    const html = await renderQueryBlockForExport(':::query-table\nlink: path\ncolumns: city\n---\nSELECT ?path ?title ?city WHERE {}\n:::', 'trip/plan.md');
    expect(h.rows).toHaveBeenCalledWith('SELECT ?path ?title ?city WHERE {}', 'sparql', { note: 'path', columns: undefined });
    expect(html).toContain('tv-table');
    expect(html).toContain('Prague');
    expect(html).toContain('Budapest');
    expect(html).toContain('data-note-link="trip/places/Kampa Museum.md"');
  });

  it('SQL goes as SQL to the view source (the note guard, in main), never the open route (#2448)', async () => {
    await renderQueryBlockForExport(':::query-list\nlanguage: sql\n---\nSELECT path, title FROM notes\n:::', 'trip/plan.md');
    expect(h.rows).toHaveBeenCalledWith('SELECT path, title FROM notes', 'sql', { note: undefined, columns: undefined });
    expect(h.tablesQuery).not.toHaveBeenCalled();
    expect(h.graphQuery).not.toHaveBeenCalled();
  });

  it('a query that fails says so in place of the view', async () => {
    h.rows.mockResolvedValue({ ok: false, error: 'Parse error on line 1' });
    const html = await renderQueryBlockForExport(':::query-list\nSELEC oops\n:::', 'trip/plan.md');
    expect(html).toContain("The query couldn't run: Parse error on line 1");
  });

  it('search results link the same way', async () => {
    h.searchQuery.mockResolvedValue([{ relativePath: 'trip/places/Kampa Museum.md', title: 'Kampa Museum', snippet: 'art', score: 1 }]);
    const html = await renderQueryBlockForExport(':::query-search\nmuseum\n:::', 'trip/plan.md');
    expect(html).toContain('data-note-link="trip/places/Kampa Museum.md"');
  });

  it('a non-directive is that block\'s error, not a thrown request', async () => {
    const r = await renderLiveBlock({ id: 'B0', kind: 'query', source: 'not a directive', notePath: 'n.md' });
    expect(r).toEqual({ id: 'B0', ok: false, error: 'not a query block' });
  });

  it('leaves nothing behind in the document', async () => {
    await renderQueryBlockForExport(':::query-list\nSELECT ?x WHERE {}\n:::', 'trip/plan.md');
    expect(document.body.children).toHaveLength(0);
  });
});
