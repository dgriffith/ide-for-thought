/**
 * @vitest-environment happy-dom
 *
 * A query block rendered for export (#2512) runs the preview's own code path —
 * the same prefixes, the same guarded SQL route, the same builders — and its
 * result links come out as links the export resolves.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const h = vi.hoisted(() => ({ graphQuery: vi.fn(), queryNote: vi.fn(), searchQuery: vi.fn() }));
vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    graph: { query: h.graphQuery },
    tables: { queryNote: h.queryNote },
    search: { query: h.searchQuery },
    embeddings: { related: vi.fn(), searchText: vi.fn() },
  },
}));

import { renderQueryBlockForExport } from '../../../src/renderer/lib/export/render-query-block';
import { renderLiveBlock } from '../../../src/renderer/lib/app/export-live-blocks';
import { QUERY_PREFIXES } from '../../../src/renderer/lib/preview/query-prefixes';

const ROWS = [
  { path: 'trip/places/Kampa Museum.md', title: 'Kampa Museum', city: 'Prague' },
  { path: 'trip/places/Széchenyi.md', title: 'Széchenyi Baths', city: 'Budapest' },
];

beforeEach(() => {
  h.graphQuery.mockResolvedValue({ ok: true, results: ROWS });
  h.queryNote.mockResolvedValue({ ok: true, columns: ['path', 'title'], rows: [['trip/places/Kampa Museum.md', 'Kampa Museum']] });
});
afterEach(() => { document.body.innerHTML = ''; vi.clearAllMocks(); });

describe('renderQueryBlockForExport', () => {
  it('a list: the preview\'s query (with its prefixes), title and builder; links resolvable', async () => {
    const html = await renderQueryBlockForExport(':::query-list\ntitle: Places\n---\nSELECT ?path ?title WHERE { ?n ?p ?o }\n:::', 'trip/plan.md');
    expect(h.graphQuery).toHaveBeenCalledWith(QUERY_PREFIXES + 'SELECT ?path ?title WHERE { ?n ?p ?o }');
    expect(html).toContain('class="minerva-live-block"');
    expect(html).toContain('data-theme="light"');
    expect(html).toContain('<h4 class="query-title">Places</h4>');
    expect(html).toContain('data-note-link="trip/places/Kampa Museum.md">Kampa Museum</a>');
    expect(html).toContain('data-note-link="trip/places/Széchenyi.md">Széchenyi Baths</a>');
    expect(html).not.toContain('data-target');
    expect(html).not.toContain('Loading...');
  });

  it('a table: every column, as the preview shows it', async () => {
    const html = await renderQueryBlockForExport(':::query-table\nSELECT ?path ?title ?city WHERE {}\n:::', 'trip/plan.md');
    expect(html).toContain('query-result-table');
    expect(html).toContain('Prague');
    expect(html).toContain('Budapest');
  });

  it('SQL goes through the guarded note route, never the open one (#2448)', async () => {
    await renderQueryBlockForExport(':::query-list\nlanguage: sql\n---\nSELECT path, title FROM notes\n:::', 'trip/plan.md');
    expect(h.queryNote).toHaveBeenCalledWith('SELECT path, title FROM notes');
    expect(h.graphQuery).not.toHaveBeenCalled();
  });

  it('a query that fails shows the preview\'s own inline error', async () => {
    h.graphQuery.mockResolvedValue({ ok: false, error: 'Parse error on line 1' });
    const html = await renderQueryBlockForExport(':::query-list\nSELEC oops\n:::', 'trip/plan.md');
    expect(html).toContain('<p class="query-error">Parse error on line 1</p>');
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
