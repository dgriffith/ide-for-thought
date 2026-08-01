import type { ConversationToolKey } from '../../../shared/conversation-tools';
import type { ToolSpec } from '../provider/types';
import type { NotebaseTool, ToolContext, ToolCallbacks, ToolResult } from './types';
import { searchNotes } from './search-notes';
import { grepNotes } from './grep-notes';
import { readNote } from './read-note';
import { readSource } from './read-source';
import { searchRelated } from './search-related';
import { searchHelp } from './search-help';
import { queryGraph } from './query-graph';
import { listNotes } from './list-notes';
import { proposeNoteRename } from './propose-note-rename';
import { proposeNoteMove } from './propose-note-move';
import { proposeReorganization } from './propose-reorganization';
import { proposeNoteDelete } from './propose-note-delete';
import { proposeFolderMove } from './propose-folder-move';
import { proposeFolderDelete } from './propose-folder-delete';
import { proposeNoteBody } from './propose-note-body';
import { proposeNotes } from './propose-notes';
import { describeGraphSchema } from './describe-graph-schema';
import { describeTables } from './describe-tables';
import { querySql } from './query-sql';
import { proposeSources } from './propose-sources';
import { fetchProperties } from './fetch-properties';
import { setProperties } from './set-properties';
import { proposeSourceProperties } from './propose-source-properties';
import { proposeNoteTypes } from './propose-note-types';
import { proposeClaims } from './propose-claims';
import { proposeCompute } from './propose-compute';
import { askUser } from './ask-user';

/**
 * The default notebase toolset, in registration order. Order is preserved in
 * `NOTEBASE_TOOLS` below (some callers/tests depend on it).
 */
const DEFAULT_TOOLS: NotebaseTool[] = [
  searchNotes,
  grepNotes,
  readNote,
  readSource,
  searchRelated,
  searchHelp,
  queryGraph,
  listNotes,
  proposeNoteRename,
  proposeNoteMove,
  proposeReorganization,
  proposeNoteDelete,
  proposeFolderMove,
  proposeFolderDelete,
  proposeNoteBody,
  proposeNotes,
  describeGraphSchema,
  describeTables,
  querySql,
  proposeSources,
  fetchProperties,
  setProperties,
  proposeSourceProperties,
  proposeNoteTypes,
  proposeClaims,
  proposeCompute,
];

export const NOTEBASE_TOOL_REGISTRY: Record<string, NotebaseTool> = Object.fromEntries(
  DEFAULT_TOOLS.map((t) => [t.definition.name, t]),
);

export const NOTEBASE_TOOLS: ToolSpec[] = DEFAULT_TOOLS.map((t) => t.definition);

/**
 * Dispatch table for `executeNotebaseTool`. Same as the default registry plus
 * the template-scoped `ask_user`, which is not in `NOTEBASE_TOOLS`.
 */
const DISPATCH: Record<string, NotebaseTool> = {
  ...NOTEBASE_TOOL_REGISTRY,
  [askUser.definition.name]: askUser,
};

const TEMPLATE_TOOL_REGISTRY: Record<ConversationToolKey, ToolSpec> = {
  ask_user: askUser.definition,
};

export interface ConversationToolOptions {
  /** Template-scoped tools to add on top of the default set. */
  extraTools?: ConversationToolKey[] | undefined;
}

/**
 * The neutral client-side toolset for a conversation: the default notebase
 * tools plus any template-scoped extras. Server-side web tools are NOT here —
 * they're provider-specific (they run on the provider's infrastructure) and are
 * added inside the provider from the request's web settings (#1148).
 */
export function buildConversationTools(opts: ConversationToolOptions): ToolSpec[] {
  const tools: ToolSpec[] = [...NOTEBASE_TOOLS];
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
