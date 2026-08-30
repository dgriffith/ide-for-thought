/**
 * describe_graph_schema tool (#1935) — returns the bundled core + thought
 * ontology Turtle verbatim. No inputs, no I/O beyond the bundled `?raw` import.
 */
import { describe, it, expect } from 'vitest';
import { executeNotebaseTool, NOTEBASE_TOOLS } from '../../../src/main/llm/tools';

describe('describe_graph_schema tool execution', () => {
  it('returns both ontologies, sectioned and never erroring', async () => {
    const out = await executeNotebaseTool({ rootPath: '/tmp/never-touched' }, 'describe_graph_schema', {});
    expect(out.isError).toBe(false);
    expect(out.content).toContain('# Minerva Core Ontology (minerva:)');
    expect(out.content).toContain('# Thought Ontology (thought:)');
    expect(out.content.indexOf('# Minerva Core Ontology')).toBeLessThan(out.content.indexOf('# Thought Ontology'));
  });

  it('ignores whatever input it is given', async () => {
    const out = await executeNotebaseTool({ rootPath: '/tmp/never-touched' }, 'describe_graph_schema', { anything: 'goes' });
    expect(out.isError).toBe(false);
    expect(out.content.length).toBeGreaterThan(0);
  });

  it('is registered in the default conversation toolset', () => {
    expect(NOTEBASE_TOOLS.map((t) => t.name)).toContain('describe_graph_schema');
  });
});
