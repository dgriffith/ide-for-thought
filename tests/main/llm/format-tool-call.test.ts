import { describe, it, expect } from 'vitest';
import { formatToolCall } from '../../../src/main/llm/format-tool-call';

describe('formatToolCall (#NEW)', () => {
  it('shows the search query for web_search', () => {
    expect(formatToolCall('web_search', { query: 'minerva graph database' }))
      .toBe('🔍 Searching the web for **minerva graph database**');
  });

  it('shows the URL for web_fetch', () => {
    expect(formatToolCall('web_fetch', { url: 'https://example.com/x' }))
      .toBe('🌐 Fetching **https://example.com/x**');
  });

  it('shows the query for search_notes', () => {
    expect(formatToolCall('search_notes', { query: 'sparql' }))
      .toBe('🔎 Searching notes for **sparql**');
  });

  it('shows the path for read_note', () => {
    expect(formatToolCall('read_note', { relative_path: 'notes/topics/foo.md' }))
      .toBe('📄 Reading **notes/topics/foo.md**');
  });

  it('shows the first non-empty line of a SPARQL query', () => {
    const sparql = '\n  \nSELECT ?s WHERE {\n  ?s a :Note .\n}';
    expect(formatToolCall('query_graph', { sparql }))
      .toBe('🧠 Running graph query: `SELECT ?s WHERE {`');
  });

  it('uses a verb-only label for describe_graph_schema', () => {
    expect(formatToolCall('describe_graph_schema', {}))
      .toBe('🧠 Inspecting graph schema');
  });

  it('shows note count for propose_notes', () => {
    expect(formatToolCall('propose_notes', { notes: [{}, {}, {}] }))
      .toBe('📝 Proposing 3 notes');
  });

  it('falls back to a JSON snippet for unknown tools', () => {
    expect(formatToolCall('mystery_tool', { foo: 'bar' }))
      .toBe('⚙️ Running `mystery_tool` {"foo":"bar"}');
  });

  it('truncates long input snippets', () => {
    const longQuery = 'a'.repeat(500);
    const out = formatToolCall('web_search', { query: longQuery });
    expect(out.length).toBeLessThan(longQuery.length);
    expect(out).toMatch(/…/);
  });

  it('returns a verb-only label when the expected field is missing', () => {
    expect(formatToolCall('web_search', {})).toBe('🔍 Searching the web');
    expect(formatToolCall('read_note', {})).toBe('📄 Reading a note');
  });

  it('handles null and missing input gracefully', () => {
    expect(formatToolCall('web_search', null)).toBe('🔍 Searching the web');
    expect(formatToolCall('web_search', undefined)).toBe('🔍 Searching the web');
  });
});
