/**
 * Conversation runtime types — names + payloads for the template-scoped
 * tool subsystem. Despite the file's location, these are not "tool
 * definitions" in the ThinkingTool sense; they're the small contract
 * between renderer and main for opt-in tools (`ask_user`) and the
 * round-trip channel that backs them.
 *
 * Pre-#515 this file was `conversation-templates.ts` and also defined
 * `ConversationTemplate` for the menu-driven decompose / crystallize
 * surface. Those templates have since been re-implemented as
 * ThinkingTools, so the `Template`-shaped types are gone.
 */

/**
 * Names of additional tools a ThinkingTool can declare via
 * `requiresTools: [...]`. The default toolset (search/read/query/
 * propose_notes/describe/web_*) is always available; anything in
 * this enum is opt-in per tool.
 */
export type ConversationToolKey = 'ask_user';

/**
 * Payload for the inline ask_user prompt. Sent main → renderer when the
 * agent calls the `ask_user` tool; the renderer renders an inline
 * question card and ships the answer back via the reply channel.
 */
export interface AskUserRequest {
  questionId: string;
  conversationId: string;
  question: string;
  choices?: string[];
}

/**
 * Payload for the inline MCP write-confirmation card (#2439). Sent main →
 * renderer when `mcp_call` targets a tool the server did not mark
 * `readOnlyHint: true` and the user hasn't chosen "Don't ask again" for it.
 *
 * `argsJson` is the call's arguments already pretty-printed by main, exactly
 * as they will be sent — the renderer shows this string verbatim rather than
 * re-serializing an object, so what the user approves is byte-for-byte what
 * goes over the wire. `description` / `title` come from the server's own
 * catalog (server-authored, not model-authored).
 */
export interface McpConfirmRequest {
  requestId: string;
  conversationId: string;
  serverName: string;
  toolName: string;
  title?: string;
  description?: string;
  argsJson: string;
  /** The server's own `destructiveHint`, when it sent one. Informational only. */
  destructiveHint?: boolean;
}
