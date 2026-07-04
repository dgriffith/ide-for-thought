import * as graph from '../../graph/index';
import { projectContext } from '../../project-context-types';
import type { NotebaseTool, ToolContext } from './types';

async function runQuery(ctx: ToolContext, input: unknown): Promise<{ content: string; isError: boolean }> {
  const { sparql } = input as { sparql: string };
  if (typeof sparql !== 'string' || !sparql.trim()) {
    throw new Error('sparql is required');
  }
  const response = await graph.queryGraph(projectContext(ctx.rootPath), sparql);
  if (response.error) {
    return {
      content: `SPARQL error: ${response.error}\n\nCall describe_graph_schema to see available classes and predicates.`,
      isError: true,
    };
  }
  if (response.results.length === 0) {
    return { content: 'No bindings.', isError: false };
  }
  return { content: JSON.stringify(response.results, null, 2), isError: false };
}

export const queryGraph: NotebaseTool = {
  definition: {
    name: 'query_graph',
    description:
      'Run a SPARQL query against the thoughtbase knowledge graph. Standard ' +
      'prefixes (minerva, thought, dc, rdf, rdfs, xsd, csvw, prov) are ' +
      'auto-injected. The graph contains notes (minerva:Note), folders, tags, ' +
      'typed wiki-links (supports, rebuts, references, etc.), frontmatter ' +
      'metadata as minerva:meta-* predicates, and thought-ontology structures ' +
      '(claims, proposals, conversations). Use SELECT for tabular results. ' +
      'If you are unsure about predicate or class names, call ' +
      'describe_graph_schema first.',
    input_schema: {
      type: 'object',
      properties: {
        sparql: {
          type: 'string',
          description: 'A SPARQL query string (SELECT / ASK / CONSTRUCT).',
        },
      },
      required: ['sparql'],
    },
  },
  run: (ctx, input) => runQuery(ctx, input),
};
