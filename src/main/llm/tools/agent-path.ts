import {
  AgentPathRefusedError,
  agentPathRefusal,
  assertAgentPath,
  assertBareId,
} from '../../path-containment';
import type { ToolContext } from './types';

/**
 * The tools' door to the agent-path guard (#2453). Every tool argument that
 * names a thoughtbase path — to read, to diff against, or as a proposal's
 * target — goes through one of these two, so `.minerva/` (transcripts,
 * `secrets.json`, the proposal store, types), `.git/`, `node_modules/` and any
 * other dot-segment stay out of reach whether spelled directly, via `..`, in
 * another case, or through an in-root symlink. The rules live in
 * `path-containment.ts`'s `agentPathRefusal`, shared with `minerva mcp`'s
 * `agentRead` and the approval engine's `assertPayloadPaths`.
 *
 * `tests/main/llm/prompt-injection/tool-surface.test.ts` fails if a tool
 * grows a path-shaped parameter without being classified there, or is
 * classified as guarded without calling one of these;
 * `agent-paths.test.ts` beside it drives every guarded tool through the real
 * loop with `.minerva/` spellings.
 */

/** Throws `AgentPathRefusedError` (which `executeNotebaseTool` turns into an
 *  error tool_result) unless `relativePath` is fine; returns it unchanged. */
export function agentPath(ctx: ToolContext, relativePath: string): string {
  assertAgentPath(ctx.rootPath, relativePath);
  return relativePath;
}

/** Non-throwing form for batch tools that skip a bad item with a warning:
 *  the refusal message, or `null` when the path is fine. */
export function agentPathProblem(ctx: ToolContext, relativePath: string): string | null {
  const why = agentPathRefusal(ctx.rootPath, relativePath);
  return why ? new AgentPathRefusedError(relativePath, why).message : null;
}

/** A source id Minerva splices into `.minerva/sources/<id>/…`: one segment,
 *  never a path. */
export function bareSourceId(id: string): string {
  return assertBareId(id, 'source_id');
}
