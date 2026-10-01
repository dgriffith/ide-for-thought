import { describe, it, expect } from 'vitest';
import { formatToolCall, humanizeToolName } from '../../../src/main/llm/format-tool-call';
import { NOTEBASE_TOOL_REGISTRY } from '../../../src/main/llm/tools/registry';

describe('formatToolCall', () => {
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

  it('shows the pattern for grep_notes, in words rather than "grepping"', () => {
    expect(formatToolCall('grep_notes', { pattern: '- [ ]' }))
      .toBe('🔦 Looking through notes for **- [ ]**');
  });

  it('shows the query for search_help', () => {
    expect(formatToolCall('search_help', { query: 'how do links work' }))
      .toBe('📖 Checking the docs for **how do links work**');
  });

  it('shows the path for read_note', () => {
    expect(formatToolCall('read_note', { relative_path: 'notes/topics/foo.md' }))
      .toBe('📄 Reading **notes/topics/foo.md**');
  });

  it('never shows the query language itself', () => {
    expect(formatToolCall('query_graph', { sparql: '\n  SELECT ?s WHERE {\n  ?s ?p ?o }' }))
      .toBe('🧠 Querying the knowledge graph');
    expect(formatToolCall('query_sql', { sql: 'SELECT * FROM museums' })).toBe('📊 Querying your tables');
    expect(formatToolCall('describe_graph_schema', {})).toBe('🧠 Looking over the knowledge graph\'s structure');
  });

  it('never shows code: analysis reads as an analysis (the transcript that prompted this)', () => {
    for (const code of [
      'import json',
      'print(text[text.find("## Best history museums"):text.find("## Best history museums")+12000])',
    ]) {
      expect(formatToolCall('code_execution', { code })).toBe('🧮 Running a quick analysis');
    }
    expect(formatToolCall('code_execution', {})).toBe('🧮 Running a quick analysis');
  });

  it('still reads a web search or fetch out of a code_execution block', () => {
    expect(formatToolCall('code_execution', { code: 'r = await web_search({"query": "prague museums"})' }))
      .toBe('🔍 Searching the web for **prague museums**');
    expect(formatToolCall('code_execution', { code: 'await web_fetch({"url": "https://x.cz"})' }))
      .toBe('🌐 Fetching **https://x.cz**');
  });

  it('describes Minerva\'s own tools in English (the other line that prompted this)', () => {
    expect(formatToolCall('list_object_types', { type_id: 'museum' })).toBe('🧩 Checking the **museum** object type');
    expect(formatToolCall('list_object_types', {})).toBe('🧩 Checking your object types');
    expect(formatToolCall('fetch_properties', { relative_path: 'locations/museums/Kampa.md' }))
      .toBe('🏷️ Checking the properties of **locations/museums/Kampa.md**');
    expect(formatToolCall('list_notes', {})).toBe('🗂️ Looking over your notes');
    expect(formatToolCall('run_skill', { skillId: 'find-opposing-arguments' }))
      .toBe('🛠️ Running the **find opposing arguments** thinking tool');
    expect(formatToolCall('mcp_call', { server: 'github', tool: 'list_issues', args: {} }))
      .toBe('🔌 Using **list issues** from github');
  });

  it('counts proposed notes from the field the tool actually takes (payloads)', () => {
    expect(formatToolCall('propose_notes', { note: 'why', payloads: [{}, {}, {}] })).toBe('📝 Proposing 3 new notes');
    expect(formatToolCall('propose_notes', { payloads: [{}] })).toBe('📝 Proposing a new note');
  });

  it('names a single proposal target, and counts several', () => {
    expect(formatToolCall('propose_note_edits', { note: 'why', edits: [{ relative_path: 'a.md' }, { relative_path: 'a.md' }] }))
      .toBe('✏️ Proposing edits to **a.md**');
    expect(formatToolCall('set_properties', { updates: [{ relativePath: 'a.md' }, { relativePath: 'b.md' }] }))
      .toBe('🏷️ Proposing property changes to 2 notes');
    expect(formatToolCall('propose_note_delete', { paths: ['old.md'] })).toBe('🗑️ Proposing to delete **old.md**');
    expect(formatToolCall('propose_folder_move', { moves: [{ path: 'a', newPath: 'b' }, { path: 'c', newPath: 'd' }] }))
      .toBe('↪️ Proposing to move 2 folders');
    expect(formatToolCall('propose_object_type', { label: 'Museum', properties: [] })).toBe('🧩 Proposing a **Museum** object type');
    expect(formatToolCall('propose_object_type', { id: 'museum', label: 'Museum', properties: [] }))
      .toBe('🧩 Proposing changes to the **Museum** object type');
  });

  it('never shows the model\'s rationale (`note`) as the target', () => {
    expect(formatToolCall('propose_note_edits', { note: 'Tidy the intro', edits: [] })).toBe('✏️ Proposing edits to notes');
  });

  it('turns an unknown tool\'s name into words instead of dumping JSON', () => {
    expect(formatToolCall('mystery_tool', { foo: 'bar' })).toBe('⚙️ Using mystery tool: **bar**');
    expect(formatToolCall('list_widgets', {})).toBe('⚙️ Listing widgets');
    expect(formatToolCall('get_weather', { city: 'Prague', days: 3 })).toBe('⚙️ Getting weather: **Prague**');
  });

  it('skips a long or multi-line argument in the fallback', () => {
    expect(humanizeToolName('summarize_text', { text: 'a\nb' })).toBe('Summarizing text');
    expect(humanizeToolName('summarize_text', { text: 'x'.repeat(200) })).toBe('Summarizing text');
  });

  it('truncates long arguments', () => {
    const longQuery = 'a'.repeat(500);
    const out = formatToolCall('web_search', { query: longQuery });
    expect(out.length).toBeLessThan(longQuery.length);
    expect(out).toContain('…');
  });

  it('returns a verb-only label when the expected field is missing', () => {
    expect(formatToolCall('web_search', {})).toBe('🔍 Searching the web');
    expect(formatToolCall('read_note', {})).toBe('📄 Reading a note');
  });

  it('handles null and missing input gracefully', () => {
    expect(formatToolCall('web_search', null)).toBe('🔍 Searching the web');
    expect(formatToolCall('web_search', undefined)).toBe('🔍 Searching the web');
  });

  it('gives every tool the model can call a sentence of its own, never the name-based fallback', () => {
    const names = [...Object.keys(NOTEBASE_TOOL_REGISTRY), 'ask_user', 'web_search', 'web_fetch', 'code_execution'];
    const fallingBack = names.filter((n) => formatToolCall(n, {}) === `⚙️ ${humanizeToolName(n)}`);
    expect(fallingBack, 'add a case to formatToolCall for each').toEqual([]);
  });

  it('never shows a snake_case tool name, a brace or a backtick, for any tool', () => {
    const names = [...Object.keys(NOTEBASE_TOOL_REGISTRY), 'ask_user', 'code_execution'];
    for (const n of names) {
      const line = formatToolCall(n, { code: 'print(1)', sparql: 'SELECT ?s {}', sql: 'SELECT 1' });
      expect(line, n).not.toMatch(/[a-z]+_[a-z]+|[{}`]/);
    }
  });
});
