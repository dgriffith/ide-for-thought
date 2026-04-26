import type Anthropic from '@anthropic-ai/sdk';
import * as fs from '../notebase/fs';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import * as search from '../search/index';
import ONTOLOGY_TTL from '../../shared/ontology.ttl?raw';
import THOUGHT_ONTOLOGY_TTL from '../../shared/ontology-thought.ttl?raw';

export interface ToolContext {
  rootPath: string;
}

export const NOTEBASE_TOOLS: Anthropic.Tool[] = [
  {
    name: 'search_notes',
    description:
      'Full-text search across all notes in the current thoughtbase. Returns ' +
      'matching notes ranked by relevance, with title, relative path, and a ' +
      'short snippet for each. Use this to find notes by keyword when you do ' +
      'not already know the exact path.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms. MiniSearch syntax is supported.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return. Defaults to 10.',
          minimum: 1,
          maximum: 50,
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_note',
    description:
      'Read the full contents of a note by its thoughtbase-relative path ' +
      '(e.g. "notes/topics/llm-trust.md"). Returns the raw markdown including ' +
      'any frontmatter. Use this when you have a path from search_notes, from ' +
      'a wiki-link in another note, or from a graph query, and need the full ' +
      'text.',
    input_schema: {
      type: 'object',
      properties: {
        relative_path: {
          type: 'string',
          description:
            'Path relative to the thoughtbase root. Must include the file ' +
            'extension. Path traversal (..) is rejected.',
        },
      },
      required: ['relative_path'],
    },
  },
  {
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
  {
    name: 'describe_graph_schema',
    description:
      'Return the full Minerva ontology as Turtle. Contains every class ' +
      '(minerva:Note, minerva:Tag, thought:Claim, etc.) and every predicate ' +
      '(minerva:supports, minerva:hasTag, dc:title, thought:hasClaim, etc.) ' +
      'used in the graph, with rdfs:label and rdfs:comment for each. Call ' +
      'this before writing a non-trivial SPARQL query if you are not sure ' +
      'what the schema looks like. The returned text is authoritative.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
];

/**
 * Server-side tools run on Anthropic's infrastructure — we just declare them
 * in the request and the API executes queries/fetches and returns structured
 * citations. Version _20260209 bundles dynamic filtering (Claude filters
 * results with code before they hit its context window).
 *
 * `allowed_domains` / `blocked_domains` are passed through per user setting;
 * they're mutually exclusive from the model's perspective but the API accepts
 * either independently.
 */
export function buildWebTools(opts: {
  allowedDomains?: string[];
  blockedDomains?: string[];
}): Anthropic.Messages.ToolUnion[] {
  const webSearch: Anthropic.Messages.WebSearchTool20260209 = {
    type: 'web_search_20260209',
    name: 'web_search',
  };
  if (opts.allowedDomains && opts.allowedDomains.length > 0) {
    webSearch.allowed_domains = opts.allowedDomains;
  } else if (opts.blockedDomains && opts.blockedDomains.length > 0) {
    webSearch.blocked_domains = opts.blockedDomains;
  }
  const webFetch: Anthropic.Messages.WebFetchTool20260209 = {
    type: 'web_fetch_20260209',
    name: 'web_fetch',
  };
  if (opts.allowedDomains && opts.allowedDomains.length > 0) {
    webFetch.allowed_domains = opts.allowedDomains;
  } else if (opts.blockedDomains && opts.blockedDomains.length > 0) {
    webFetch.blocked_domains = opts.blockedDomains;
  }
  return [webSearch, webFetch];
}

export interface ConversationToolOptions {
  web: {
    enabled: boolean;
    allowedDomains?: string[];
    blockedDomains?: string[];
  };
}

export function buildConversationTools(
  opts: ConversationToolOptions,
): Anthropic.Messages.ToolUnion[] {
  const tools: Anthropic.Messages.ToolUnion[] = [...NOTEBASE_TOOLS];
  if (opts.web.enabled) {
    tools.push(...buildWebTools({
      allowedDomains: opts.web.allowedDomains,
      blockedDomains: opts.web.blockedDomains,
    }));
  }
  return tools;
}

export async function executeNotebaseTool(
  ctx: ToolContext,
  name: string,
  input: unknown,
): Promise<{ content: string; isError: boolean }> {
  try {
    switch (name) {
      case 'search_notes':
        return { content: await runSearch(ctx, input), isError: false };
      case 'read_note':
        return { content: await runRead(ctx, input), isError: false };
      case 'query_graph':
        return runQuery(ctx, input);
      case 'describe_graph_schema':
        return { content: runDescribeSchema(), isError: false };
      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { content: `Tool ${name} failed: ${message}`, isError: true };
  }
}

async function runSearch(ctx: ToolContext, input: unknown): Promise<string> {
  const { query, limit } = input as { query: string; limit?: number };
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('query is required');
  }
  const results = search.search(projectContext(ctx.rootPath), query, { limit: limit ?? 10 });
  if (results.length === 0) {
    return `No results for "${query}".`;
  }
  return results
    .map((r, i) => {
      const snippet = r.snippet.replace(/\s+/g, ' ').trim().slice(0, 240);
      return `${i + 1}. ${r.title} (${r.relativePath})\n   ${snippet}`;
    })
    .join('\n');
}

async function runRead(ctx: ToolContext, input: unknown): Promise<string> {
  const { relative_path } = input as { relative_path: string };
  if (typeof relative_path !== 'string' || !relative_path) {
    throw new Error('relative_path is required');
  }
  return fs.readFile(ctx.rootPath, relative_path);
}

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

function runDescribeSchema(): string {
  return [
    '# Minerva Core Ontology (minerva:)',
    '',
    ONTOLOGY_TTL,
    '',
    '# Thought Ontology (thought:)',
    '',
    THOUGHT_ONTOLOGY_TTL,
  ].join('\n');
}
