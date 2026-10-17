/**
 * What registering an LLM tool requires (#2628, epic #2622): its class, and
 * for any parameter that names a path, the guard it goes through. This used to
 * live only in `tool-surface.test.ts`, as a list kept beside the toolset by
 * hand; it is now part of the registration, so a tool can't register without
 * saying what it does.
 *
 * Validated when the registry is built (`defineToolRegistry`), which runs at
 * module load: a tool with a path-shaped parameter and no guard, a guard on a
 * tool with none, or a name registered twice throws there. The type makes the
 * class mandatory. Plugins' MCP-backed tools will register here as `external`
 * (#2615).
 */
import type { NotebaseTool } from './types';

export type ToolClass =
  /** Reads the thoughtbase, the graph, the tables or the docs. */
  | 'read'
  /** Emits a draft for the review card, or files a PENDING proposal. */
  | 'propose'
  /** Calls a user-configured MCP server — gated per call by `confirmMcpCall` (#2439). */
  | 'external'
  /** Runs a stock/user skill as a sub-prompt; its output is drafts. */
  | 'skill'
  /** Round-trips a question to the user. */
  | 'interactive';

/**
 * How a tool's path-shaped arguments are kept out of `.minerva/` (#2453), and
 * the file under `tools/` that calls the guard.
 * - `agentPath`: `assertAgentPath` — no hidden or ignored segment, as spelled
 *   or after following symlinks, inside the root;
 * - `bareSourceId`: one segment, never a path, for an id Minerva splices into
 *   `.minerva/sources/<id>/…` itself;
 * - `draftPath`: a path inside a drafted skill or plugin (#2652), never the
 *   thoughtbase: `draftPathProblem`, via `checkExtensionDraft`. Main writes
 *   it only under a folder the user chose, or a scratch one.
 */
export interface ToolPathGuard {
  guard: 'agentPath' | 'bareSourceId' | 'draftPath';
  site: string;
}

export interface ToolRegistration {
  tool: NotebaseTool;
  class: ToolClass;
  /** Required exactly when the tool has a path-shaped parameter. */
  pathGuard?: ToolPathGuard;
  /** Offered only when a skill asks for it (`requiresTools`), not by default. */
  templateOnly?: boolean;
}

/** A parameter name that holds a thoughtbase path, or an id spliced into one. */
export const PATH_SHAPED_PARAM = /(path|paths|folder|folders|dir|file|files)$|^newName$|source_?id$/i;

/** Every path-shaped property name anywhere in a JSON schema (nested objects
 *  and array items included), as a dotted trail. */
export function pathParams(schema: unknown, trail = ''): string[] {
  if (!schema || typeof schema !== 'object') return [];
  const s = schema as { properties?: Record<string, unknown>; items?: unknown };
  const out: string[] = [];
  for (const [k, v] of Object.entries(s.properties ?? {})) {
    const here = trail ? `${trail}.${k}` : k;
    if (PATH_SHAPED_PARAM.test(k)) out.push(here);
    out.push(...pathParams(v, here));
  }
  if (s.items) out.push(...pathParams(s.items, `${trail}[]`));
  return out;
}

/** Check a set of registrations; throws on the first that can't register. */
export function defineToolRegistry(entries: readonly ToolRegistration[]): readonly ToolRegistration[] {
  const seen = new Set<string>();
  for (const e of entries) {
    const name = e.tool.definition.name;
    if (seen.has(name)) throw new Error(`LLM tool "${name}" is registered twice`);
    seen.add(name);
    const paths = pathParams(e.tool.definition.input_schema);
    if (paths.length > 0 && !e.pathGuard) {
      throw new Error(`LLM tool "${name}" takes a path (${paths.join(', ')}) but registers no pathGuard — route it through tools/agent-path.ts (#2453)`);
    }
    if (paths.length === 0 && e.pathGuard) {
      throw new Error(`LLM tool "${name}" registers a pathGuard but takes no path-shaped parameter`);
    }
  }
  return entries;
}
