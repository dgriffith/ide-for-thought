import type Anthropic from '@anthropic-ai/sdk';
import type { ConversationToolKey } from '../../../shared/conversation-tools';
import type { NotebaseTool, ToolContext, ToolCallbacks, ToolResult } from './types';
import { searchNotes } from './search-notes';
import { readNote } from './read-note';
import { searchRelated } from './search-related';
import { queryGraph } from './query-graph';
import { listNotes } from './list-notes';
import { proposeNoteRename } from './propose-note-rename';
import { proposeNoteMove } from './propose-note-move';
import { proposeReorganization } from './propose-reorganization';
import { proposeNoteDelete } from './propose-note-delete';
import { proposeNoteBody } from './propose-note-body';
import { proposeNotes } from './propose-notes';
import { describeGraphSchema } from './describe-graph-schema';
import { describeTables } from './describe-tables';
import { querySql } from './query-sql';
import { proposeSources } from './propose-sources';
import { fetchProperties } from './fetch-properties';
import { setProperties } from './set-properties';
import { proposeSourceProperties } from './propose-source-properties';
import { proposeClaims } from './propose-claims';
import { proposeCompute } from './propose-compute';
import { askUser } from './ask-user';

/**
 * The default notebase toolset, in registration order. Order is preserved in
 * `NOTEBASE_TOOLS` below (some callers/tests depend on it).
 */
const DEFAULT_TOOLS: NotebaseTool[] = [
  searchNotes,
  readNote,
  searchRelated,
  queryGraph,
  listNotes,
  proposeNoteRename,
  proposeNoteMove,
  proposeReorganization,
  proposeNoteDelete,
  proposeNoteBody,
  proposeNotes,
  describeGraphSchema,
  describeTables,
  querySql,
  proposeSources,
  fetchProperties,
  setProperties,
  proposeSourceProperties,
  proposeClaims,
  proposeCompute,
];

export const NOTEBASE_TOOL_REGISTRY: Record<string, NotebaseTool> = Object.fromEntries(
  DEFAULT_TOOLS.map((t) => [t.definition.name, t]),
);

export const NOTEBASE_TOOLS: Anthropic.Tool[] = DEFAULT_TOOLS.map((t) => t.definition);

/**
 * Dispatch table for `executeNotebaseTool`. Same as the default registry plus
 * the template-scoped `ask_user`, which is not in `NOTEBASE_TOOLS`.
 */
const DISPATCH: Record<string, NotebaseTool> = {
  ...NOTEBASE_TOOL_REGISTRY,
  [askUser.definition.name]: askUser,
};

const TEMPLATE_TOOL_REGISTRY: Record<ConversationToolKey, Anthropic.Tool> = {
  ask_user: askUser.definition,
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
): Promise<ToolResult> {
  const tool = DISPATCH[name];
  if (!tool) {
    return { content: `Unknown tool: ${name}`, isError: true };
  }
  try {
    return await tool.run(ctx, input, callbacks);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { content: `Tool ${name} failed: ${message}`, isError: true };
  }
}
