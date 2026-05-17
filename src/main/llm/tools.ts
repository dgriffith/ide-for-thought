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
import type {
  ConversationSourceDraft,
  DraftSource,
  ProposeSourcesInput,
} from '../../shared/conversation-source-drafts';
import type {
  ConversationPropertyDraft,
  PropertyUpdate,
  SetPropertiesInput,
} from '../../shared/conversation-property-drafts';
import type {
  ConversationComputeDraft,
  ProposeComputeInput,
} from '../../shared/conversation-compute-drafts';
import { scanPythonSafety } from '../../shared/python-safety';
import type { ConversationToolKey } from '../../shared/conversation-tools';
import { fixupBundleLinks } from '../../shared/refactor/bundle-link-fixup';
import { readFrontmatterProperties } from '../../shared/refactor/frontmatter-patch';
import type { PropertyPatch, PropertyValue } from '../../shared/refactor/frontmatter-patch';
import { detectIdentifier } from '../sources/ingest-identifier';
import { normalizeUrl } from '../sources/source-id';

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
 * Side-channel callbacks the tool runner can invoke. Wired by the
 * conversation IPC handler — `onDraft` forwards `propose_notes` payloads
 * to the renderer; `askUser` round-trips a question through an inline
 * UI prompt and resolves with the user's reply.
 */
export interface ToolCallbacks {
  onDraft?: (draft: ConversationDraft) => void;
  /** Counterpart to `onDraft` for the `propose_sources` tool. Wired by
   *  the conversation IPC handler; forwards source-ingest drafts to the
   *  renderer via `Channels.CONVERSATION_SOURCE_DRAFT`. Without it,
   *  propose_sources errors with "no UI surface" — same shape as
   *  propose_notes when invoked outside a conversation context. */
  onSourceDraft?: (draft: ConversationSourceDraft) => void;
  /** Counterpart to `onDraft` for the `set_properties` tool. Forwards
   *  frontmatter-patch drafts to the renderer for inline review. */
  onPropertyDraft?: (draft: ConversationPropertyDraft) => void;
  /** Counterpart to `onDraft` for the `propose_compute` tool (#245).
   *  Forwards SPARQL / SQL / Python cell drafts to the renderer for
   *  inline review. The user clicks Run / Insert / Discard. */
  onComputeDraft?: (draft: ConversationComputeDraft) => void;
  askUser?: (input: { question: string; choices?: string[] }) => Promise<string>;
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
      'standard approval engine, Reject discards.\n' +
      '\n' +
      'CRITICAL — wiki-link rule: when one note in the bundle links to another, ' +
      'the wiki-link target MUST be the basename of the OTHER note\'s ' +
      'relativePath (filename without the .md extension), spelled IDENTICALLY. ' +
      'Wiki-link resolution is exact-match on basename — `[[Sets, Functions, ' +
      'and the Need for Types]]` only resolves to ' +
      '`notes/.../Sets, Functions, and the Need for Types.md`. Pick paths and ' +
      'link targets together, in one pass; do not invent friendlier names for ' +
      'links. Bad: `[[stop-1]]` while the file is `notes/.../Sets, Functions, ' +
      'and the Need for Types.md`. Good: `[[Sets, Functions, and the Need for ' +
      'Types]]`. Prefer paths without commas/punctuation in the basename if you ' +
      'can — they\'re easier to link to.',
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
                  'Apply-time collision dedup will append "-2" if a file already exists at the path. ' +
                  'Pick basenames you are willing to use as wiki-link targets unchanged — see CRITICAL rule in the tool description.',
              },
              content: {
                type: 'string',
                description:
                  'Full note body in GitHub-flavored markdown. Include a level-1 heading and any frontmatter you want. ' +
                  'When linking to a sibling note in this same bundle, use [[<basename>]] where <basename> is the OTHER ' +
                  'payload\'s relativePath without the trailing ".md" — spelled IDENTICALLY (capitalisation, punctuation, spaces).',
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
  {
    name: 'propose_sources',
    description:
      'Propose one or more sources (papers, articles, web pages) for the ' +
      'user to ingest into their Sources library. Use this when you have ' +
      'identified specific references the user would benefit from — a paper ' +
      'cited in a note, a foundational article on a topic they are ' +
      'exploring, a web resource the user would want filed for citation. ' +
      'The user reviews the bundle as an inline card; on Approve, Minerva ' +
      'runs its standard ingest pipeline (Readability for arbitrary URLs; ' +
      'Crossref / arXiv / PubMed for identifiers) to fetch metadata and ' +
      'archive the source under `.minerva/sources/<id>/`. Duplicates are ' +
      'detected automatically and skipped without overwriting — you can ' +
      'safely propose a source even if you are unsure whether the user ' +
      'already has it.\n' +
      '\n' +
      'For each source, supply EXACTLY ONE of:\n' +
      '  - `identifier`: a DOI (`10.1038/s41586-023-06924-6`), arXiv id ' +
      '(`2301.12345`), or PubMed id (`12345678`). Prefix-tolerant — `doi:`, ' +
      '`arXiv:`, `pmid:`, full URLs like `https://doi.org/10.…` and ' +
      '`https://arxiv.org/abs/…` all normalize correctly. **Prefer ' +
      'identifiers over URLs whenever available** — the ingest pipeline ' +
      'gets richer, structured metadata from Crossref/arXiv/PubMed than ' +
      'from page scraping, including authors, abstract, journal/venue, and ' +
      'open-access PDF when advertised.\n' +
      '  - `url`: an http(s) URL. Use only for sources without a stable ' +
      'identifier (blog posts, news articles, documentation pages, etc.).\n' +
      '\n' +
      'You may also call `web_search` first to find candidate sources, then ' +
      '`propose_sources` to file the best matches.',
    input_schema: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description:
            'A short sentence describing why you are proposing these ' +
            'sources. Surfaced to the user on the inline review card.',
        },
        sources: {
          type: 'array',
          minItems: 1,
          maxItems: 32,
          description:
            'One or more sources to propose. Use a single propose_sources ' +
            'call for the whole bundle rather than several calls — the user ' +
            'reviews the bundle as one card.',
          items: {
            type: 'object',
            properties: {
              identifier: {
                type: 'string',
                description:
                  'DOI / arXiv id / PubMed id (prefix-tolerant). Mutually ' +
                  'exclusive with `url`.',
              },
              url: {
                type: 'string',
                description:
                  'http(s) URL of the source. Mutually exclusive with ' +
                  '`identifier`. Use only when no stable identifier exists.',
              },
            },
          },
        },
      },
      required: ['note', 'sources'],
    },
  },
  {
    name: 'fetch_properties',
    description:
      'Read the YAML frontmatter properties of a note. Returns the ' +
      'frontmatter as a JSON object — keys like `title`, `tags`, `status`, ' +
      'custom user fields, etc. Returns `{}` when the note has no ' +
      'frontmatter or the YAML is malformed. Use this before ' +
      '`set_properties` when you need to read the existing value of a key ' +
      'you intend to update (e.g. to append to an array rather than ' +
      'replace it). Does not load the note body — call `read_note` for ' +
      'that.',
    input_schema: {
      type: 'object',
      properties: {
        relative_path: {
          type: 'string',
          description:
            'Path relative to the thoughtbase root, including the `.md` ' +
            'extension. Path traversal (..) is rejected.',
        },
      },
      required: ['relative_path'],
    },
  },
  {
    name: 'set_properties',
    description:
      'Propose YAML-frontmatter property updates on one or more notes. ' +
      'Use this for any structured-metadata change: setting a `status`, ' +
      'editing `tags`, recording a custom field like `priority` or ' +
      '`reviewed`, updating `title`, etc. The user reviews the bundle as ' +
      'an inline card; on Approve, each note is read, its frontmatter ' +
      'patched, and the file written back. On Discard nothing is written.\n' +
      '\n' +
      'Semantics: SHALLOW MERGE. Listed keys replace the value at that ' +
      'key; setting a value to `null` deletes the key; other keys in the ' +
      "frontmatter are left untouched. If you need to append to an array " +
      'rather than replace it, call `fetch_properties` first to read the ' +
      'current value, then submit the combined array.\n' +
      '\n' +
      'Use ONE `set_properties` call for the whole bundle (the user reviews ' +
      'all updates as a single card) rather than calling it once per note. ' +
      'When the only change is adding/removing a tag, you may still prefer ' +
      '`set_properties` with `{ tags: [...] }` so the user sees the diff ' +
      'instead of a silent tag mutation.',
    input_schema: {
      type: 'object',
      properties: {
        note: {
          type: 'string',
          description:
            'A short sentence describing why you are proposing this ' +
            'update. Surfaced to the user on the inline review card.',
        },
        updates: {
          type: 'array',
          minItems: 1,
          maxItems: 64,
          description:
            'One or more per-note patches. Each entry targets one note ' +
            'and shallow-merges its `properties` into the frontmatter.',
          items: {
            type: 'object',
            properties: {
              relativePath: {
                type: 'string',
                description:
                  'Project-relative path to the note (include `.md`). The ' +
                  'note must already exist — use `propose_notes` to ' +
                  'create new notes.',
              },
              properties: {
                type: 'object',
                description:
                  'Shallow patch. Each key is set to the given value; a ' +
                  '`null` value deletes the key. Values may be strings, ' +
                  'numbers, booleans, arrays, or nested objects — anything ' +
                  'YAML can encode.',
                additionalProperties: true,
              },
            },
            required: ['relativePath', 'properties'],
          },
        },
      },
      required: ['note', 'updates'],
    },
  },
  {
    name: 'propose_compute',
    description:
      'Propose a code cell (SPARQL, SQL, or Python) for the user to review and run. ' +
      'Use this when answering a question would benefit from actual computation over ' +
      'the user\'s data — counting graph nodes, joining CSV tables, fitting a model, ' +
      'plotting a distribution — rather than your own narrative answer. The cell is ' +
      'rendered as a reviewable inline card; the user clicks Run to execute it, ' +
      'Insert into notebook to file it as a permanent cell, or Discard. Per the ' +
      'Trust Principle, you cannot execute code yourself — every cell goes through ' +
      'human review first.\n' +
      '\n' +
      'After Run, the output is appended to the conversation as context for your ' +
      'NEXT turn — so you can comment on the result, refine the query, or propose ' +
      'a follow-up cell. Don\'t describe the expected output inline; let the user ' +
      'run it and see.\n' +
      '\n' +
      'Language guidance:\n' +
      '  - `sparql` — query the knowledge graph (notes, tags, claims, sources, etc.). ' +
      'Use the standard minerva/thought/dc prefixes; they\'re auto-injected.\n' +
      '  - `sql` — query CSV tables registered in DuckDB. Table names follow the ' +
      'project-relative path with `/` and `.` collapsed to `_` (or the user\'s ' +
      '`table_name:` override). Call `read_note` on the companion `.md` first if ' +
      'unsure about a table\'s shape.\n' +
      '  - `python` — pandas / numpy / matplotlib analysis. Network calls, ' +
      'subprocess, and file-write APIs are flagged in the UI and require an extra ' +
      'confirmation — avoid them unless genuinely necessary.\n' +
      '\n' +
      'The `minerva` Python module is the canonical way to reach project data ' +
      '(just `import minerva` at the top of the cell). Every helper returns ' +
      'plain dicts / lists of dicts — NOT custom classes. Access fields with ' +
      'bracket notation (`note[\'body\']`), not dot notation.\n' +
      '\n' +
      '  minerva.sparql(query) -> pandas.DataFrame\n' +
      '    Columns match the SELECT variable names verbatim (no `?` prefix).\n' +
      '    SELECT ?relativePath ?title  →  df columns: [\'relativePath\', \'title\']\n' +
      '\n' +
      '  minerva.sql(query) -> pandas.DataFrame\n' +
      '    Columns match the SQL projection.\n' +
      '\n' +
      '  minerva.notes.read(rel_path) -> dict\n' +
      '    Returns {\'relativePath\', \'title\', \'frontmatter\', \'tags\', \'body\'}.\n' +
      '    To get the markdown source: minerva.notes.read(p)[\'body\'].\n' +
      '\n' +
      '  minerva.notes.by_tag(tag) -> list[dict]\n' +
      '    Each item: {\'relativePath\', \'title\'}.\n' +
      '\n' +
      '  minerva.notes.search(query, limit=20) -> list[dict]\n' +
      '    Each item: {\'relativePath\', \'title\', \'snippet\', \'score\'}.\n' +
      '\n' +
      '  minerva.sources.get(source_id) -> dict (SourceDetail)\n' +
      '  minerva.sources.citing(source_id) -> list[dict]\n' +
      '  minerva.excerpts.for_source(source_id) -> list[str]\n' +
      '  minerva.ctx() -> {\'project_root\': str, \'notebook_path\': str | None}\n' +
      '\n' +
      'Common pitfalls to avoid:\n' +
      '  - There is no `from minerva import read_note`. Use `minerva.notes.read(p)`.\n' +
      '  - DataFrame columns are NOT renamed for ergonomics — `?relativePath` in ' +
      'SPARQL becomes `df[\'relativePath\']`, not `df[\'path\']`. Match the column ' +
      'name to the variable name exactly.\n' +
      '  - Notes are dicts; field access is `note[\'body\']` not `note.body`.\n' +
      '  - For the project root, use `minerva.ctx()[\'project_root\']` rather than ' +
      '`os.environ` so you don\'t trip the safety scan.\n' +
      '\n' +
      'One proposal per turn. End the turn with a one-sentence preamble (e.g. ' +
      '"I drafted a query — run it when ready.") and stop.',
    input_schema: {
      type: 'object',
      properties: {
        language: {
          type: 'string',
          enum: ['sparql', 'sql', 'python'],
          description:
            'Which executor the cell targets. SPARQL hits the graph; SQL hits DuckDB ' +
            'over registered CSV tables; Python runs in the project\'s kernel.',
        },
        code: {
          type: 'string',
          description:
            'The cell body, exactly as you want the user to see it. No surrounding ' +
            'markdown fence; the renderer adds language-aware syntax highlighting. ' +
            'Make the cell self-contained — the user may run it without your turn ' +
            'still in scope.',
        },
        rationale: {
          type: 'string',
          description:
            'One short sentence describing what this cell will compute and why ' +
            'it\'s the right answer to the user\'s question. Surfaced on the card.',
        },
      },
      required: ['language', 'code', 'rationale'],
    },
  },
];

/**
 * Template-scoped tools. NOT in the default toolset; templates opt in via
 * `requiresTools: ['ask_user']` on their ConversationTemplate definition.
 * Keeps "ask the user" from becoming a crutch in freeform conversations
 * where there is no UI affordance to render the question.
 */
const ASK_USER_TOOL: Anthropic.Tool = {
  name: 'ask_user',
  description:
    'Ask the user a question and wait for their reply. Use this ONLY when ' +
    'you need a decision you cannot reasonably resolve via the other tools ' +
    '(search, read, query) AND that materially changes what you produce. ' +
    'Examples: "should I split by section or by topic?", "which of these two ' +
    'interpretations should I run with?". Do NOT use this for confirmation, ' +
    'politeness, or to summarize what you are about to do — only for ' +
    'genuinely missing decisions. The user sees an inline prompt; their ' +
    'reply (free text or one of the choices) becomes the tool result.',
  input_schema: {
    type: 'object',
    properties: {
      question: {
        type: 'string',
        description:
          'A short, specific question. One sentence when possible. ' +
          'Provide only the question — no preamble, no explanation.',
      },
      choices: {
        type: 'array',
        items: { type: 'string' },
        description:
          'Optional list of suggested answers, rendered as clickable chips. ' +
          'The user may still answer freely. Omit when the question is genuinely open.',
        maxItems: 8,
      },
    },
    required: ['question'],
  },
};

const TEMPLATE_TOOL_REGISTRY: Record<ConversationToolKey, Anthropic.Tool> = {
  ask_user: ASK_USER_TOOL,
};

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
  /** Template-scoped tools to add on top of the default set. */
  extraTools?: ConversationToolKey[];
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
  if (opts.extraTools) {
    const seen = new Set<string>();
    for (const key of opts.extraTools) {
      if (seen.has(key)) continue;
      seen.add(key);
      const t = TEMPLATE_TOOL_REGISTRY[key];
      if (t) tools.push(t);
    }
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
      case 'propose_sources':
        return runProposeSources(ctx, input, callbacks);
      case 'fetch_properties':
        return { content: await runFetchProperties(ctx, input), isError: false };
      case 'set_properties':
        return runSetProperties(ctx, input, callbacks);
      case 'propose_compute':
        return runProposeCompute(ctx, input, callbacks);
      case 'ask_user':
        return runAskUser(input, callbacks);
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

  // Models routinely pick human-readable relativePaths ("Sets, Functions,
  // and the Need for Types.md") and link them with shorter convenience
  // names ("[[stop-1]]") — those don't resolve. Walk the bundle and
  // rewrite inter-bundle wiki-links so they target sibling basenames.
  const fixup = fixupBundleLinks(
    parsed.payloads.map((p) => ({ relativePath: p.relativePath, content: p.content })),
  );
  if (fixup.rewritten.length > 0) {
    console.log(
      `[propose_notes] rewrote ${fixup.rewritten.reduce((n, r) => n + r.rewrites.length, 0)} ` +
      `inter-bundle wiki-link(s) across ${fixup.rewritten.length} note(s)`,
    );
  }
  const fixedPayloads: DraftPayload[] = parsed.payloads.map((p, i) => ({
    kind: 'note',
    relativePath: p.relativePath,
    content: fixup.notes[i].content,
  }));

  const draft: ConversationDraft = {
    draftId: `draft-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: parsed.note,
    payloads: fixedPayloads,
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
      // Be very explicit about stopping. An ambiguous "continue naturally"
      // hint led the model into a tool-use loop — calling propose_notes
      // again, and again, and again, up to maxIterations.
      hint: 'STOP. The bundle has been queued for user review. End this turn with ONE short acknowledgement sentence ("Drafted N notes for review.") and DO NOT call propose_notes again in this turn. DO NOT call any other tool. DO NOT repeat the note contents inline.',
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

/**
 * Counterpart to `runProposeNotes` for sources. The tool emits a draft
 * containing the validated URL/identifier list; the actual ingest runs
 * in the IPC handler for `CONVERSATION_FILE_SOURCE_DRAFT` once the user
 * approves the inline card. Trust-principle parity: the LLM proposes,
 * the human approves.
 */
function runProposeSources(
  ctx: ToolContext,
  input: unknown,
  callbacks: ToolCallbacks,
): { content: string; isError: boolean } {
  if (!callbacks.onSourceDraft) {
    return {
      content: 'propose_sources is only available in conversation contexts.',
      isError: true,
    };
  }
  if (!ctx.conversationId) {
    return {
      content: 'propose_sources requires a bound conversation id.',
      isError: true,
    };
  }
  const parsed = parseProposeSourcesInput(input);
  if ('error' in parsed) {
    return { content: parsed.error, isError: true };
  }

  const draft: ConversationSourceDraft = {
    draftId: `srcdraft-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: parsed.note,
    sources: parsed.sources,
    createdAt: new Date().toISOString(),
  };
  callbacks.onSourceDraft(draft);

  const summary = parsed.sources
    .map((s) => s.identifier ?? s.url ?? '')
    .filter(Boolean)
    .join(', ');
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      sourceCount: parsed.sources.length,
      proposed: parsed.sources.map((s) =>
        s.identifier ? { identifier: s.identifier } : { url: s.url ?? '' },
      ),
      // Match the propose_notes hint so the model doesn't loop.
      hint:
        'STOP. The source bundle has been queued for user review. End this ' +
        'turn with ONE short acknowledgement sentence ("Proposed N source(s) ' +
        'for review.") and DO NOT call propose_sources again in this turn. ' +
        'DO NOT call any other tool. DO NOT repeat the URLs/identifiers ' +
        'inline.',
    }) + `\n\n(queued source draft: ${summary})`,
    isError: false,
  };
}

function parseProposeSourcesInput(
  input: unknown,
): ProposeSourcesInput | { error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'propose_sources input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const note = typeof obj.note === 'string' ? obj.note.trim() : '';
  if (!note) return { error: '`note` is required and must be a non-empty string.' };
  if (!Array.isArray(obj.sources) || obj.sources.length === 0) {
    return { error: '`sources` must be a non-empty array.' };
  }
  const sources: DraftSource[] = [];
  for (const raw of obj.sources) {
    if (!raw || typeof raw !== 'object') {
      return { error: 'Each source entry must be an object.' };
    }
    const s = raw as Record<string, unknown>;
    const identifier = typeof s.identifier === 'string' ? s.identifier.trim() : '';
    const url = typeof s.url === 'string' ? s.url.trim() : '';
    if (identifier && url) {
      return {
        error:
          'Each source entry must supply exactly one of `identifier` or ' +
          `\`url\`, not both: ${JSON.stringify(raw)}`,
      };
    }
    if (!identifier && !url) {
      return {
        error:
          'Each source entry must supply exactly one of `identifier` or ' +
          `\`url\`: ${JSON.stringify(raw)}`,
      };
    }
    if (identifier) {
      if (!detectIdentifier(identifier)) {
        return {
          error:
            `Not a recognised DOI / arXiv id / PubMed id: ${identifier}. ` +
            'Examples: "10.1038/s41586-023-06924-6", "2301.12345", ' +
            '"12345678", "doi:10.…", "arXiv:2301.…", or the canonical ' +
            'doi.org / arxiv.org / pubmed URL.',
        };
      }
      sources.push({ identifier });
    } else {
      if (!normalizeUrl(url)) {
        return { error: `Not a valid http(s) URL: ${url}` };
      }
      sources.push({ url });
    }
  }
  return { note, sources };
}

async function runAskUser(
  input: unknown,
  callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  if (!callbacks.askUser) {
    return {
      content: 'ask_user is not available in this context — the conversation surface has no UI to render the question.',
      isError: true,
    };
  }
  if (!input || typeof input !== 'object') {
    return { content: 'ask_user input must be an object.', isError: true };
  }
  const obj = input as Record<string, unknown>;
  const question = typeof obj.question === 'string' ? obj.question.trim() : '';
  if (!question) {
    return { content: 'ask_user requires a non-empty `question` string.', isError: true };
  }
  let choices: string[] | undefined;
  if (Array.isArray(obj.choices)) {
    const filtered = obj.choices
      .filter((c): c is string => typeof c === 'string' && c.trim().length > 0)
      .map((c) => c.trim());
    if (filtered.length > 0) choices = filtered;
  }
  const answer = await callbacks.askUser({ question, choices });
  return { content: answer, isError: false };
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

/**
 * Trust-principle parity with the other propose_* tools (#245):
 * `propose_compute` never executes the cell. It validates the input,
 * runs the Python-safety scan (no-op for sparql/sql), and emits a
 * `ConversationComputeDraft`. The renderer shows an inline reviewable
 * card; the user clicks Run to execute, Insert to file as a notebook
 * cell, or Discard.
 */
function runProposeCompute(
  ctx: ToolContext,
  input: unknown,
  callbacks: ToolCallbacks,
): { content: string; isError: boolean } {
  if (!callbacks.onComputeDraft) {
    return {
      content: 'propose_compute is only available in conversation contexts.',
      isError: true,
    };
  }
  if (!ctx.conversationId) {
    return {
      content: 'propose_compute requires a bound conversation id.',
      isError: true,
    };
  }
  const parsed = parseProposeComputeInput(input);
  if ('error' in parsed) {
    return { content: parsed.error, isError: true };
  }
  const safetyFlags = parsed.language === 'python'
    ? scanPythonSafety(parsed.code).map((f) => ({ id: f.id, message: f.message }))
    : [];
  const draft: ConversationComputeDraft = {
    draftId: `cmpdraft-${randomUUID()}`,
    conversationId: ctx.conversationId,
    language: parsed.language,
    code: parsed.code,
    rationale: parsed.rationale,
    safetyFlags,
    createdAt: new Date().toISOString(),
  };
  callbacks.onComputeDraft(draft);
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      language: draft.language,
      safetyFlags: safetyFlags.map((f) => f.id),
      // Same anti-loop hint that propose_notes / propose_sources /
      // set_properties use. The model otherwise tends to re-emit the
      // proposal in subsequent iterations of the same turn.
      hint:
        'STOP. The cell has been queued for the user to review. End this ' +
        'turn with ONE short acknowledgement sentence (e.g. "I drafted a ' +
        `${parsed.language} cell — run it when ready.") and DO NOT call ` +
        'propose_compute again in this turn. DO NOT call any other tool. ' +
        'The cell output will arrive in the NEXT turn as user-role context — ' +
        'comment on it then.',
    }) + `\n\n(queued ${parsed.language} draft)`,
    isError: false,
  };
}

function parseProposeComputeInput(input: unknown): ProposeComputeInput | { error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'propose_compute input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const language = obj.language;
  if (language !== 'sparql' && language !== 'sql' && language !== 'python') {
    return { error: '`language` must be one of "sparql", "sql", "python".' };
  }
  const code = typeof obj.code === 'string' ? obj.code : '';
  if (!code.trim()) {
    return { error: '`code` is required and must be a non-empty string.' };
  }
  const rationale = typeof obj.rationale === 'string' ? obj.rationale.trim() : '';
  if (!rationale) {
    return { error: '`rationale` is required and must be a non-empty string.' };
  }
  return { language, code, rationale };
}

/**
 * Read the frontmatter of a single note and return it as JSON. No
 * approval gate — this is read-only and symmetric with `read_note`.
 */
async function runFetchProperties(ctx: ToolContext, input: unknown): Promise<string> {
  const { relative_path } = input as { relative_path: string };
  if (typeof relative_path !== 'string' || !relative_path) {
    throw new Error('relative_path is required');
  }
  const content = await fs.readFile(ctx.rootPath, relative_path);
  const props = readFrontmatterProperties(content);
  return JSON.stringify(props, null, 2);
}

/**
 * Trust-principle parity with `propose_notes` / `propose_sources`:
 * `set_properties` does NOT write. It validates the bundle, emits a
 * `ConversationPropertyDraft` for inline user review, and returns
 * "drafted." The IPC handler for `CONVERSATION_FILE_PROPERTY_DRAFT`
 * applies the writes once the user approves.
 */
function runSetProperties(
  ctx: ToolContext,
  input: unknown,
  callbacks: ToolCallbacks,
): { content: string; isError: boolean } {
  if (!callbacks.onPropertyDraft) {
    return {
      content: 'set_properties is only available in conversation contexts.',
      isError: true,
    };
  }
  if (!ctx.conversationId) {
    return {
      content: 'set_properties requires a bound conversation id.',
      isError: true,
    };
  }
  const parsed = parseSetPropertiesInput(input);
  if ('error' in parsed) {
    return { content: parsed.error, isError: true };
  }

  const draft: ConversationPropertyDraft = {
    draftId: `propdraft-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: parsed.note,
    updates: parsed.updates,
    createdAt: new Date().toISOString(),
  };
  callbacks.onPropertyDraft(draft);

  const summary = parsed.updates
    .map((u) => `${u.relativePath} (${Object.keys(u.properties).length} key${Object.keys(u.properties).length === 1 ? '' : 's'})`)
    .join(', ');
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      updateCount: parsed.updates.length,
      proposed: parsed.updates.map((u) => ({
        relativePath: u.relativePath,
        keys: Object.keys(u.properties),
      })),
      // Same anti-loop hint as propose_notes / propose_sources — the
      // model has historically retried draft-emitting tools when it
      // didn't see a "successful" write effect in the result.
      hint:
        'STOP. The property bundle has been queued for user review. End ' +
        'this turn with ONE short acknowledgement sentence ' +
        '("Proposed N property update(s) for review.") and DO NOT call ' +
        'set_properties again in this turn. DO NOT call any other tool. ' +
        'DO NOT repeat the property values inline.',
    }) + `\n\n(queued property draft: ${summary})`,
    isError: false,
  };
}

function parseSetPropertiesInput(
  input: unknown,
): SetPropertiesInput | { error: string } {
  if (!input || typeof input !== 'object') {
    return { error: 'set_properties input must be an object.' };
  }
  const obj = input as Record<string, unknown>;
  const note = typeof obj.note === 'string' ? obj.note.trim() : '';
  if (!note) return { error: '`note` is required and must be a non-empty string.' };
  if (!Array.isArray(obj.updates) || obj.updates.length === 0) {
    return { error: '`updates` must be a non-empty array.' };
  }
  const updates: PropertyUpdate[] = [];
  for (const raw of obj.updates) {
    if (!raw || typeof raw !== 'object') {
      return { error: 'Each update entry must be an object.' };
    }
    const u = raw as Record<string, unknown>;
    const relativePath = typeof u.relativePath === 'string' ? u.relativePath.trim() : '';
    if (!relativePath) {
      return { error: 'Each update entry must include a non-empty `relativePath`.' };
    }
    if (relativePath.includes('..')) {
      return { error: `relativePath must not contain '..': ${relativePath}` };
    }
    if (!u.properties || typeof u.properties !== 'object' || Array.isArray(u.properties)) {
      return { error: `update for ${relativePath}: \`properties\` must be a non-array object.` };
    }
    const props = u.properties as Record<string, unknown>;
    if (Object.keys(props).length === 0) {
      return { error: `update for ${relativePath}: \`properties\` must include at least one key.` };
    }
    // Validate each value can round-trip through YAML. We accept the
    // loose PropertyValue shape (scalars, arrays, nested objects, null);
    // anything outside that means the model sent something exotic
    // (undefined, function, bigint) — reject early so the user doesn't
    // approve a no-op patch.
    const sanitized: PropertyPatch = {};
    for (const [k, v] of Object.entries(props)) {
      if (!isPropertyValue(v)) {
        return { error: `update for ${relativePath}: value for key "${k}" is not a YAML-encodable scalar/array/object/null.` };
      }
      sanitized[k] = v;
    }
    updates.push({ relativePath, properties: sanitized });
  }
  return { note, updates };
}

function isPropertyValue(v: unknown): v is PropertyValue {
  if (v === null) return true;
  if (typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean') return true;
  if (Array.isArray(v)) return v.every(isPropertyValue);
  if (typeof v === 'object') {
    return Object.values(v as Record<string, unknown>).every(isPropertyValue);
  }
  return false;
}
