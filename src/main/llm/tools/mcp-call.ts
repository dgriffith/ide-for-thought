import type { NotebaseTool, ToolCallbacks, ToolContext } from './types';
import { callServerTool } from '../../mcp-servers/registry';
import type { McpContentBlock } from '../../mcp-client';
import type { McpServerStatus } from '../../../shared/mcp-servers';

/**
 * mcp_call — the dispatcher tool for #2028: one namespaced entry point for
 * every connected MCP server's tools instead of flattening each of them into
 * a top-level ToolSpec. The catalog of what's callable is rendered as text
 * into this tool's `description` per-conversation (`describeMcpCatalog`,
 * consumed by `buildConversationTools` in `./registry`) rather than as
 * separate schema entries, so the array Claude sees never grows with the
 * number of connected servers or their tool counts.
 *
 * Confirmation gate (#2439): MCP tools act on third-party services, not on
 * Minerva's graph, so the approval engine doesn't cover them. The same idea
 * applies anyway — the LLM proposes, the human confirms — so a call to any
 * tool the server did NOT mark `readOnlyHint: true` waits for the user to
 * Allow it in an inline conversation card (`callbacks.confirmMcpCall`), unless
 * they chose "Don't ask again" for that exact server config + tool. With no
 * conversation UI to ask in (CLI, eval harness, a background run, a closed
 * window) such a call is refused. The gate itself is in `callServerTool`
 * (`mcp-servers/registry.ts`), where no caller can route around it.
 *
 * Residual risk, accepted: `readOnlyHint` is the server's own claim, and a
 * server that mislabels a write tool as read-only gets it run unconfirmed.
 */
function flattenMcpContent(blocks: McpContentBlock[]): string {
  const parts = blocks.map((block) => {
    if (block.type === 'text' && typeof block.text === 'string') return block.text;
    return `[non-text content: ${block.type}]`;
  });
  return parts.join('\n').trim() || '(empty result)';
}

interface McpCallInput {
  server: string;
  tool: string;
  args: Record<string, unknown>;
}

function parseInput(input: unknown): McpCallInput | { error: string } {
  if (!input || typeof input !== 'object') return { error: 'mcp_call input must be an object.' };
  const obj = input as Record<string, unknown>;
  const server = typeof obj.server === 'string' ? obj.server.trim() : '';
  const tool = typeof obj.tool === 'string' ? obj.tool.trim() : '';
  if (!server) return { error: 'mcp_call requires a non-empty `server` name — see the catalog in this tool\'s description.' };
  if (!tool) return { error: 'mcp_call requires a non-empty `tool` name — see the catalog in this tool\'s description.' };
  const args = (obj.args && typeof obj.args === 'object') ? obj.args as Record<string, unknown> : {};
  return { server, tool, args };
}

/** The tool_result for a call the gate stopped. Nothing reached the server in
 *  any of these cases, and the text says so — the model must not report the
 *  action as done. */
function declinedMessage(where: string, reason: 'denied' | 'cancelled' | 'no-ui'): string {
  switch (reason) {
    case 'denied':
      return `The user declined the call to ${where}. Nothing was sent to the server. ` +
        'Do not retry it; continue without it, or ask the user how they want to proceed.';
    case 'cancelled':
      return `The call to ${where} was cancelled before the user confirmed it. Nothing was sent to the server.`;
    case 'no-ui':
      return `mcp_call refused ${where}: the tool is not marked read-only, so it needs the user's ` +
        'confirmation, and there is no conversation window here to ask in (a skill or background ' +
        'run, the CLI, or a closed window). Nothing was sent to the server.';
  }
}

async function runMcpCall(
  _ctx: ToolContext,
  input: unknown,
  callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  const parsed = parseInput(input);
  if ('error' in parsed) return { content: parsed.error, isError: true };
  try {
    const outcome = await callServerTool(parsed.server, parsed.tool, parsed.args, callbacks.confirmMcpCall ?? null);
    if (outcome.kind === 'declined') {
      return { content: declinedMessage(`${parsed.server}/${parsed.tool}`, outcome.reason), isError: true };
    }
    const { result } = outcome;
    return { content: flattenMcpContent(result.content), isError: result.isError };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return { content: `mcp_call failed: ${message}`, isError: true };
  }
}

/** Renders the live catalog of connected servers' tools as text, appended to
 *  `mcp_call`'s base description by `buildConversationTools`. Intentionally
 *  compact — a one-line-per-tool param summary, not a nested JSON Schema
 *  dump; deeply nested input schemas are a known v1 limitation. */
export function describeMcpCatalog(servers: McpServerStatus[]): string {
  const lines: string[] = [];
  for (const server of servers) {
    if (server.status !== 'connected' || server.tools.length === 0) continue;
    for (const tool of server.tools) {
      const props = tool.inputSchema.properties ?? {};
      const required = new Set(tool.inputSchema.required ?? []);
      const params = Object.keys(props).map((name) => (required.has(name) ? name : `${name}?`)).join(', ');
      const hint = tool.annotations?.readOnlyHint === true ? ' [read-only]' : ' [may modify external state]';
      const desc = tool.description ? `: ${tool.description}` : '';
      lines.push(`- ${server.name}/${tool.name}${desc} (params: ${params || 'none'})${hint}`);
    }
  }
  if (lines.length === 0) return '';
  return `\n\nAvailable servers and tools:\n${lines.join('\n')}`;
}

export const mcpCall: NotebaseTool = {
  definition: {
    name: 'mcp_call',
    description:
      'Call a tool exposed by a connected MCP server. Pass `server` (the server ' +
      'name from the catalog below), `tool` (the tool name), and `args` (an ' +
      'object matching that tool\'s parameters). One dispatcher for every ' +
      'connected server\'s tools, rather than one top-level tool per server tool.',
    input_schema: {
      type: 'object',
      properties: {
        server: { type: 'string', description: 'Server name, from the catalog below.' },
        tool: { type: 'string', description: 'Tool name on that server, from the catalog below.' },
        args: {
          type: 'object',
          description: "Arguments for the target tool, per its catalog entry's params.",
          additionalProperties: true,
        },
      },
      required: ['server', 'tool'],
    },
  },
  run: (ctx, input, callbacks) => runMcpCall(ctx, input, callbacks),
};
