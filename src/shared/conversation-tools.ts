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
