import { randomUUID } from 'node:crypto';
import type Anthropic from '@anthropic-ai/sdk';
import * as fs from '../notebase/fs';
import * as graph from '../graph/index';
import { projectContext } from '../project-context-types';
import * as search from '../search/index';
import ONTOLOGY_TTL from '../../shared/ontology.ttl?raw';
import THOUGHT_ONTOLOGY_TTL from '../../shared/ontology-thought.ttl?raw';
import type {
  ConversationDraft,
  DraftPayload,
  ProposeNotesInput,
} from '../../shared/conversation-drafts';

export interface ToolContext {
  rootPath: string;
  /**
   * Identifier of the conversation this tool execution is bound to. Required
   * for any tool that drafts proposals (`propose_notes`) so the draft event
   * can be routed back to the right ConversationDialog. Optional for tools
   * that don't draft.
   */
  conversationId?: string;
}

/**
 * Side-channel callbacks the tool runner can invoke. `onDraft` is the only
 * one today and is wired by the conversation IPC handler to forward drafts
 * to the renderer via `Channels.CONVERSATION_DRAFT`.
 */
export interface ToolCallbacks {
  onDraft?: (draft: ConversationDraft) => void;
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
    name: 'propose_notes',
    description:
      'Propose one or more new notes for the user to review. Use this when ' +
      'you want to file structured prose into the thoughtbase (e.g. a ' +
      'learning-journey index + per-stop child notes, an explanation broken ' +
      'into linked sub-notes, a summary of a research finding). The user ' +
      'reviews the bundle as an inline card; Approve files them through the ' +
      'standard approval engine, Reject discards. You will be told the bundle ' +
      'was drafted — assume the user will see it. Continue your response ' +
      'naturally; do NOT repeat the note contents inline.',
    input_schema: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description:
            'A short sentence describing why you are proposing this bundle. ' +
            'Surfaced to the user on the inline review card.',
        },
        payloads: {
          type: 'array',
          minItems: 1,
          maxItems: 64,
          description: 'One or more note payloads to file. Use a single propose_notes call for the whole bundle (parent + children) rather than several calls — the user reviews the bundle as one card.',
          items: {
            type: 'object',
            properties: {
              kind: {
                type: 'string',
                enum: ['note'],
                description: 'Only "note" is supported today.',
              },
              relativePath: {
                type: 'string',
                description:
                  'Project-relative target path, e.g. "notes/distributed-consensus/raft.md". ' +
                  'Apply-time collision dedup will append "-2" if a file already exists at the path.',
              },
              content: {
                type: 'string',
                description:
                  'Full note body in GitHub-flavored markdown. Include a level-1 heading and any frontmatter you want.',
              },
            },
            required: ['kind', 'relativePath', 'content'],
          },
        },
      },
      required: ['note', 'payloads'],
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
  callbacks: ToolCallbacks = {},
): Promise<{ content: string; isError: boolean }> {
  try {
    switch (name) {
      case 'search_notes':
        return { content: runSearch(ctx, input), isError: false };
      case 'read_note':
        return { content: await runRead(ctx, input), isError: false };
      case 'query_graph':
        return runQuery(ctx, input);
      case 'describe_graph_schema':
        return { content: runDescribeSchema(), isError: false };
      case 'propose_notes':
        return runProposeNotes(ctx, input, callbacks);
      default:
        return { content: `Unknown tool: ${name}`, isError: true };
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { content: `Tool ${name} failed: ${message}`, isError: true };
  }
}

function runSearch(ctx: ToolContext, input: unknown): string {
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

/**
 * The propose_notes tool deliberately does NOT call proposeWrite. Doing
 * so here would file the bundle behind the user's back, which violates
 * the trust principle ("LLM proposes, human approves"). Instead it
 * builds a ConversationDraft, hands it to the renderer via the
 * onDraft callback, and returns to the model with a brief
 * acknowledgement.
 */
function runProposeNotes(
  ctx: ToolContext,
  input: unknown,
  callbacks: ToolCallbacks,
): { content: string; isError: boolean } {
  if (!callbacks.onDraft) {
    return {
      content: 'propose_notes is only available in conversation contexts.',
      isError: true,
    };
  }
  if (!ctx.conversationId) {
    return {
      content: 'propose_notes requires a bound conversation id.',
      isError: true,
    };
  }
  const parsed = parseProposeNotesInput(input);
  if ('error' in parsed) {
    return { content: parsed.error, isError: true };
  }

  const draft: ConversationDraft = {
    draftId: `draft-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: parsed.note,
    payloads: parsed.payloads,
    createdAt: new Date().toISOString(),
  };
  callbacks.onDraft(draft);

  const titles = parsed.payloads.map((p) => p.relativePath).join(', ');
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      noteCount: parsed.payloads.length,
      paths: parsed.payloads.map((p) => p.relativePath),
      hint: 'The user is reviewing the bundle inline. Continue your response naturally; do not repeat the note contents.',
    }) + `\n\n(filed as draft: ${titles})`,
    isError: false,
  };
}

function parseProposeNotesInput(
  input: unknown,
): ProposeNotesInput | { error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'propose_notes input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const note = typeof obj.note === 'string' ? obj.note.trim() : '';
  if (!note) return { error: '`note` is required and must be a non-empty string.' };
  if (!Array.isArray(obj.payloads) || obj.payloads.length === 0) {
    return { error: '`payloads` must be a non-empty array.' };
  }
  const payloads: DraftPayload[] = [];
  for (const raw of obj.payloads) {
    if (!raw || typeof raw !== 'object') {
      return { error: 'Each payload must be an object.' };
    }
    const p = raw as Record<string, unknown>;
    if (p.kind !== 'note') {
      return { error: `Unsupported payload kind: ${String(p.kind)}. Only "note" is supported today.` };
    }
    const relativePath = typeof p.relativePath === 'string' ? p.relativePath.trim() : '';
    const content = typeof p.content === 'string' ? p.content : '';
    if (!relativePath) return { error: 'payload.relativePath is required.' };
    if (!content) return { error: 'payload.content is required.' };
    if (relativePath.includes('..') || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
      return { error: `Unsafe relativePath: ${relativePath}` };
    }
    payloads.push({ kind: 'note', relativePath, content });
  }
  return { note, payloads };
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
