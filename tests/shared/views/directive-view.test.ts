/**
 * @vitest-environment happy-dom
 *
 * `:::query-list` / `:::query-table` as query views (#2947): the spec each
 * directive means, settings mapped one to one; the other directive kinds
 * left alone; and "Convert to view"'s fence, which reads back as the same
 * view.
 */
import { describe, it, expect } from 'vitest';
import { directiveAsFence, directiveViewSpec } from '../../../src/shared/views/directive-view';
import { parseObjectViewSpec } from '../../../src/renderer/lib/markdown/object-view-renderer';

const Q = 'SELECT ?path ?title WHERE { ?n minerva:relativePath ?path ; dc:title ?title }';

describe('directiveViewSpec (#2947)', () => {
  it('a list: its query, SPARQL, the list layout; nothing it didn\'t say', () => {
    expect(directiveViewSpec('list', `  ${Q}\n`, {})).toEqual({ query: Q, language: 'sparql', layout: 'list' });
  });

  it('a table: title, link → note, columns → visible columns, language', () => {
    expect(directiveViewSpec('table', 'SELECT * FROM places', { title: ' Places ', link: 'path', columns: 'city, rating ,', language: 'sql' }))
      .toEqual({ query: 'SELECT * FROM places', language: 'sql', layout: 'table', title: 'Places', note: 'path', columns: ['city', 'rating'] });
  });

  it('a chart, a search, a semantic or backlinks block, or an empty query, is not a view', () => {
    for (const type of ['timeseries', 'search', 'semantic', 'backlinks']) expect(directiveViewSpec(type, Q, {})).toBeNull();
    expect(directiveViewSpec('list', '  ', {})).toBeNull();
  });
});

describe('directiveAsFence (#2947)', () => {
  it('writes an object-view fence that reads back as the same query view', () => {
    const fence = directiveAsFence('table', Q, { title: 'Notes', link: 'path', columns: 'title' })!;
    expect(fence).toMatch(/^```object-view\n[\s\S]*\n```\n$/);
    const spec = parseObjectViewSpec(/```object-view\n([\s\S]*)\n```/.exec(fence)![1]!);
    expect(spec.source).toEqual({ kind: 'query', query: Q, language: 'sparql', note: 'path', title: 'Notes' });
    expect(spec).toMatchObject({ layout: 'table', columns: ['title'] });
    expect(directiveAsFence('timeseries', Q, {})).toBeNull();
  });
});
