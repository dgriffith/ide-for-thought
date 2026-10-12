import type { ConversationToolKey } from '../../../shared/conversation-tools';
import type { ToolSpec } from '../provider/types';
import type { NotebaseTool, ToolContext, ToolCallbacks, ToolResult } from './types';
import { listServerStatuses } from '../../mcp-servers/registry';
import { mcpCall, describeMcpCatalog } from './mcp-call';
import { runSkill, describeSkillCatalog } from './run-skill';
import { searchNotes } from './search-notes';
import { grepNotes } from './grep-notes';
import { readNote } from './read-note';
import { readSource } from './read-source';
import { searchRelated } from './search-related';
import { searchHelp } from './search-help';
import { queryGraph } from './query-graph';
import { listNotes } from './list-notes';
import { listObjectTypes } from './list-object-types';
import { listExtensionPoints, describeExtensionPoint } from './extension-points';
import { proposeNoteRename } from './propose-note-rename';
import { proposeNoteMove } from './propose-note-move';
import { proposeReorganization } from './propose-reorganization';
import { proposeNoteDelete } from './propose-note-delete';
import { proposeFolderMove } from './propose-folder-move';
import { proposeFolderDelete } from './propose-folder-delete';
import { proposeNoteBody } from './propose-note-body';
import { proposeNoteEdits } from './propose-note-edits';
import { proposeNotes } from './propose-notes';
import { describeGraphSchema } from './describe-graph-schema';
import { describeTables } from './describe-tables';
import { querySql } from './query-sql';
import { proposeSources } from './propose-sources';
import { fetchProperties } from './fetch-properties';
import { setProperties } from './set-properties';
import { proposeSourceProperties } from './propose-source-properties';
import { proposeNoteTypes } from './propose-note-types';
import { proposeObjectType } from './propose-object-type';
import { proposeClaims } from './propose-claims';
import { proposeCompute } from './propose-compute';
import { askUser } from './ask-user';
import { rethrowIfTrustGuard } from '../../graph/index';
import { defineToolRegistry, type ToolRegistration } from './tool-registry';

/**
 * Every LLM tool, in registration order (#2628) — the order the default
 * toolset is offered in (`NOTEBASE_TOOLS`; some callers/tests depend on it).
 * Each registers with its class and, for a path-shaped parameter, its guard;
 * `defineToolRegistry` refuses one that doesn't (see `tool-registry.ts`).
 */
const TOOLS = defineToolRegistry([
  { tool: searchNotes, class: 'read' },
  { tool: grepNotes, class: 'read' },
  { tool: readNote, class: 'read', pathGuard: { guard: 'agentPath', site: 'read-note.ts' } },
  { tool: readSource, class: 'read', pathGuard: { guard: 'bareSourceId', site: 'read-source.ts' } },
  // Its lookup is index-only, and it's guarded anyway.
  { tool: searchRelated, class: 'read', pathGuard: { guard: 'agentPath', site: 'search-related.ts' } },
  { tool: searchHelp, class: 'read' },
  { tool: queryGraph, class: 'read' },
  { tool: listNotes, class: 'read' },
  { tool: listObjectTypes, class: 'read' },
  // The extension-point catalog (#2619): static, no thoughtbase reads.
  { tool: listExtensionPoints, class: 'read' },
  { tool: describeExtensionPoint, class: 'read' },
  // move + rename share `runProposeRefactorBatch`, which checks both endpoints.
  { tool: proposeNoteRename, class: 'propose', pathGuard: { guard: 'agentPath', site: '_shared.ts' } },
  { tool: proposeNoteMove, class: 'propose', pathGuard: { guard: 'agentPath', site: '_shared.ts' } },
  { tool: proposeReorganization, class: 'propose', pathGuard: { guard: 'agentPath', site: 'propose-reorganization.ts' } },
  { tool: proposeNoteDelete, class: 'propose', pathGuard: { guard: 'agentPath', site: 'propose-note-delete.ts' } },
  { tool: proposeFolderMove, class: 'propose', pathGuard: { guard: 'agentPath', site: 'propose-folder-move.ts' } },
  { tool: proposeFolderDelete, class: 'propose', pathGuard: { guard: 'agentPath', site: 'propose-folder-delete.ts' } },
  { tool: proposeNoteBody, class: 'propose', pathGuard: { guard: 'agentPath', site: 'propose-note-body.ts' } },
  // Shares `readNoteForEdit` with propose_note_body, which is where the guard is.
  { tool: proposeNoteEdits, class: 'propose', pathGuard: { guard: 'agentPath', site: 'propose-note-body.ts' } },
  { tool: proposeNotes, class: 'propose', pathGuard: { guard: 'agentPath', site: 'propose-notes.ts' } },
  { tool: describeGraphSchema, class: 'read' },
  { tool: describeTables, class: 'read' },
  { tool: querySql, class: 'read' },
  { tool: proposeSources, class: 'propose' },
  { tool: fetchProperties, class: 'read', pathGuard: { guard: 'agentPath', site: 'fetch-properties.ts' } },
  { tool: setProperties, class: 'propose', pathGuard: { guard: 'agentPath', site: 'set-properties.ts' } },
  { tool: proposeSourceProperties, class: 'propose', pathGuard: { guard: 'bareSourceId', site: 'propose-source-properties.ts' } },
  { tool: proposeNoteTypes, class: 'propose', pathGuard: { guard: 'agentPath', site: 'propose-note-types.ts' } },
  { tool: proposeObjectType, class: 'propose' },
  { tool: proposeClaims, class: 'propose', pathGuard: { guard: 'bareSourceId', site: 'propose-claims.ts' } },
  { tool: proposeCompute, class: 'propose' },
  { tool: mcpCall, class: 'external' },
  { tool: runSkill, class: 'skill', pathGuard: { guard: 'agentPath', site: 'run-skill.ts' } },
  // Template-scoped: offered only to a skill that `requiresTools: [ask_user]`.
  { tool: askUser, class: 'interactive', templateOnly: true },
]);

/** Every registered tool's registration, by name — what the tool-surface
 *  test reads classes and path guards from. */
export const TOOL_REGISTRATIONS: Readonly<Record<string, ToolRegistration>> = Object.fromEntries(
  TOOLS.map((r) => [r.tool.definition.name, r]),
);

/** The default toolset (everything not template-only), by name. */
export const NOTEBASE_TOOL_REGISTRY: Record<string, NotebaseTool> = Object.fromEntries(
  TOOLS.filter((r) => !r.templateOnly).map((r) => [r.tool.definition.name, r.tool]),
);

export const NOTEBASE_TOOLS: ToolSpec[] = TOOLS.filter((r) => !r.templateOnly).map((r) => r.tool.definition);

/** Dispatch table for `executeNotebaseTool`: every registered tool. */
const DISPATCH: Record<string, NotebaseTool> = Object.fromEntries(TOOLS.map((r) => [r.tool.definition.name, r.tool]));

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
 *
 * Async because `mcp_call` (#2028) needs the live MCP server list to decide
 * whether to include itself at all, and to render its per-conversation
 * catalog text — see the block below.
 */
export async function buildConversationTools(opts: ConversationToolOptions): Promise<ToolSpec[]> {
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

  // mcp_call only belongs in the array once there's something for it to call —
  // an empty catalog is a tool the model can never use, same reasoning as why
  // a disabled skill doesn't appear. Its catalog text is per-conversation, so
  // it's cloned rather than mutating the shared NOTEBASE_TOOLS entry.
  const mcpIndex = tools.findIndex((t) => t.name === mcpCall.definition.name);
  if (mcpIndex !== -1) {
    const servers = await listServerStatuses();
    const catalog = describeMcpCatalog(servers);
    if (catalog) {
      tools[mcpIndex] = { ...mcpCall.definition, description: mcpCall.definition.description + catalog };
    } else {
      tools.splice(mcpIndex, 1);
    }
  }

  // run_skill (#2165): same reasoning as mcp_call above — a catalog of zero
  // runnable skills is a tool the model can never use.
  const runSkillIndex = tools.findIndex((t) => t.name === runSkill.definition.name);
  if (runSkillIndex !== -1) {
    const catalog = describeSkillCatalog();
    if (catalog) {
      tools[runSkillIndex] = { ...runSkill.definition, description: runSkill.definition.description + catalog };
    } else {
      tools.splice(runSkillIndex, 1);
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
    // A tripped write guard is a Trust Principle bypass, not a tool failure the
    // model should see and retry around (#2373). Folding it into an error
    // tool_result would turn the guard's under-test throw into a string the
    // conversation carries on past — CLAUDE.md: never swallow a TrustGuardError.
    rethrowIfTrustGuard(e);
    const message = e instanceof Error ? e.message : String(e);
    return { content: `Tool ${name} failed: ${message}`, isError: true };
  }
}
