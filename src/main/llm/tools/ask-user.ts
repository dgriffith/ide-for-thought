import type { NotebaseTool, ToolCallbacks } from './types';

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

/**
 * Template-scoped tools. NOT in the default toolset; templates opt in via
 * `requiresTools: ['ask_user']` on their ConversationTemplate definition.
 * Keeps "ask the user" from becoming a crutch in freeform conversations
 * where there is no UI affordance to render the question.
 */
export const askUser: NotebaseTool = {
  definition: {
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
  },
  run: (_ctx, input, callbacks) => runAskUser(input, callbacks),
};
