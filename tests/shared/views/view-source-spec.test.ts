/**
 * Where a view's notes come from (#2945): a type, an inline query or a saved
 * query by file name — exactly one; the fields Save / Copy as markdown write;
 * the stable key a query view is tabbed and navigated by; its title.
 */
import { describe, it, expect } from 'vitest';
import { parseViewSource, queryFileLanguage, queryViewTitle, sourceFields, viewKeyFor } from '../../../src/shared/views/view-source-spec';
import { buildViewEmbed } from '../../../src/shared/objects/view-note';

const Q = 'SELECT ?note ?due WHERE { ?note minerva:meta-due ?due }';

describe('parseViewSource (#2945)', () => {
  it('reads each form', () => {
    expect(parseViewSource({ typeId: 'task' })).toEqual({ kind: 'type', typeId: 'task' });
    expect(parseViewSource({ query: Q })).toEqual({ kind: 'query', query: Q, language: 'sparql' });
    expect(parseViewSource({ query: 'SELECT * FROM t', language: 'sql', note: 'path', columnTypes: 'due:date' }))
      .toEqual({ kind: 'query', query: 'SELECT * FROM t', language: 'sql', note: 'path', columnTypes: 'due:date' });
    expect(parseViewSource({ queryFile: 'overdue.rq' })).toEqual({ kind: 'queryFile', queryFile: 'overdue.rq' });
  });

  it('exactly one source is required; a bad language is an error', () => {
    for (const spec of [{}, { typeId: 'task', query: Q }, { query: Q, queryFile: 'a.rq' }, { typeId: '' }, { query: '   ' }]) {
      expect(parseViewSource(spec)).toEqual({ error: 'Exactly one of "typeId", "query" or "queryFile" is required' });
    }
    expect(parseViewSource({ query: Q, language: 'cypher' })).toEqual({ error: '"language" must be "sparql" or "sql"' });
  });

  it('a query file\'s language is its extension\'s', () => {
    expect(queryFileLanguage('overdue.rq')).toBe('sparql');
    expect(queryFileLanguage('sales.SQL')).toBe('sql');
  });
});

describe('the spec written, and read back (#2945)', () => {
  it('Save / Copy as markdown write the query form; a queryFile stays a reference', () => {
    const inline = parseViewSource({ query: Q, note: 'note' });
    if ('error' in inline || inline.kind === 'type') throw new Error('expected a query');
    const md = buildViewEmbed({ typeId: viewKeyFor(inline), source: inline, layout: 'table', sortColumn: null, sortDir: 'asc', columns: null });
    const body = JSON.parse(/```object-view\n([\s\S]*)\n```/.exec(md)![1]!) as Record<string, unknown>;
    expect(body).toEqual({ query: Q, language: 'sparql', note: 'note', layout: 'table' });
    expect(parseViewSource(body)).toEqual(inline); // round-trips

    const file = { kind: 'queryFile' as const, queryFile: 'overdue.rq' };
    const md2 = buildViewEmbed({ typeId: viewKeyFor(file), source: file, layout: 'timeline', sortColumn: null, sortDir: 'asc', columns: null });
    expect(md2).toContain('"queryFile": "overdue.rq"');
    expect(md2).not.toContain('SELECT');
    expect(sourceFields({ kind: 'type', typeId: 'task' })).toEqual({ typeId: 'task' });
  });

  it('a type view still writes its typeId and nothing else about its source', () => {
    const md = buildViewEmbed({ typeId: 'task', layout: 'list', sortColumn: null, sortDir: 'asc', columns: null });
    expect(JSON.parse(/```object-view\n([\s\S]*)\n```/.exec(md)![1]!)).toEqual({ typeId: 'task', layout: 'list' });
  });
});

describe('viewKeyFor and queryViewTitle (#2945)', () => {
  it('the same query is the same key; a different query, language or option is another', () => {
    const a = viewKeyFor({ kind: 'query', query: Q, language: 'sparql' });
    expect(a).toMatch(/^query:[0-9a-f]{8}$/);
    expect(viewKeyFor({ kind: 'query', query: Q, language: 'sparql' })).toBe(a);
    expect(viewKeyFor({ kind: 'query', query: `${Q} `, language: 'sparql' })).not.toBe(a);
    expect(viewKeyFor({ kind: 'query', query: Q, language: 'sql' })).not.toBe(a);
    expect(viewKeyFor({ kind: 'query', query: Q, language: 'sparql', note: 'x' })).not.toBe(a);
    expect(viewKeyFor({ kind: 'queryFile', queryFile: 'overdue.rq' })).toBe('query-file:overdue.rq');
    expect(viewKeyFor({ kind: 'type', typeId: 'task' })).toBe('task');
  });

  it('is titled by its file, else "Query view"', () => {
    expect(queryViewTitle({ kind: 'queryFile', queryFile: 'overdue.rq' })).toBe('overdue');
    expect(queryViewTitle({ kind: 'query', query: Q, language: 'sparql' })).toBe('Query view');
  });
});
