/**
 * query_graph tool (#1935) — thin wrapper over graph.queryGraph. Covers the
 * three response shapes the tool maps to a ToolResult: bound rows, an empty
 * "No bindings." result, and a SPARQL error pointing at describe_graph_schema.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { executeNotebaseTool, NOTEBASE_TOOLS } from '../../../src/main/llm/tools';
import { indexAllNotes } from '../../../src/main/graph/index';
import { type ProjectContext } from '../../../src/main/project-context-types';
import { useGraphProject } from '../../helpers/temp-project';

describe('query_graph tool execution', () => {
  const project = useGraphProject('minerva-query-graph-');
  let root: string;
  let ctx: ProjectContext;

  beforeEach(() => {
    root = project.root;
    ctx = project.ctx;
  });

  it('returns matching bindings as JSON', async () => {
    fs.writeFileSync(path.join(root, 'a.md'), '---\ntitle: A\n---\n# A\n', 'utf-8');
    await indexAllNotes(ctx);
    const out = await executeNotebaseTool(
      ctx,
      'query_graph',
      { sparql: 'SELECT ?n WHERE { ?n a minerva:Note }' },
    );
    expect(out.isError).toBe(false);
    const rows = JSON.parse(out.content) as unknown[];
    expect(rows.length).toBeGreaterThan(0);
  });

  it('reports "No bindings." for a well-formed query with no matches', async () => {
    const out = await executeNotebaseTool(
      ctx,
      'query_graph',
      { sparql: 'SELECT ?n WHERE { ?n a minerva:NoSuchClass }' },
    );
    expect(out.isError).toBe(false);
    expect(out.content).toBe('No bindings.');
  });

  it('surfaces a SPARQL error and points at describe_graph_schema', async () => {
    const out = await executeNotebaseTool(ctx, 'query_graph', { sparql: 'this is not sparql' });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/^SPARQL error:/);
    expect(out.content).toMatch(/describe_graph_schema/);
  });

  it('requires a non-empty sparql string', async () => {
    const out = await executeNotebaseTool(ctx, 'query_graph', { sparql: '  ' });
    expect(out.isError).toBe(true);
    expect(out.content).toMatch(/Tool query_graph failed: sparql is required/);
  });

  it('is registered in the default conversation toolset', () => {
    expect(NOTEBASE_TOOLS.map((t) => t.name)).toContain('query_graph');
  });
});
