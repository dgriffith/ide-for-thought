/**
 * Slash-command template shape — shared by the renderer registry and
 * (eventually, when typed-`/foo` lands) the main-process dispatcher.
 *
 * A template is a thin wrapper: it owns the user-visible label, the
 * prompt that gets auto-sent as the first user turn, and a list of
 * non-default tools the agent should have access to in this conversation.
 * The agent itself runs through the standard `completeWithTools` loop —
 * no bespoke main-process pipeline is invoked.
 */

/**
 * Names of additional tools a template can declare. The default toolset
 * (search/read/query/propose_notes/describe/web_*) is always available;
 * anything in this enum is opt-in per template.
 */
export type ConversationToolKey = 'ask_user';

export interface TemplateContext {
  /** Project-relative path of the note the template was invoked from.
   *  May be null for templates invoked outside any note context. */
  notePath: string | null;
  /** Note's body content at invocation time, when the caller has it
   *  cached. Templates may interpolate this directly into the prompt to
   *  save the agent a round-trip; otherwise the agent uses `read_note`. */
  noteContent?: string;
  /** Note's title — frontmatter title or file basename — when known. */
  noteTitle?: string;
}

export interface ConversationTemplate {
  /** Stable id used in URLs / logs / typed-slash dispatch. */
  id: string;
  /** Short user-visible label for menus. */
  label: string;
  /** Returns the user-turn text to auto-send when the template fires. */
  buildPrompt(ctx: TemplateContext): string;
  /** Returns the tab title. Falls back to a heuristic if omitted. */
  suggestedTitle?(ctx: TemplateContext): string;
  /** Non-default tools to add to this conversation's toolset. */
  requiresTools?: ConversationToolKey[];
}

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
