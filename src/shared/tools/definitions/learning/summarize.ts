import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';

const SYSTEM_PROMPT = `You are a summarization assistant for a note-taking thinking tool.

First, produce a crisp summary of the note the user is working in. Lead with one sentence that captures the core idea, then give 3–6 bullets covering the substantive moves (claims, arguments, decisions, open questions — whatever matters). Stay concrete. Don't pad.

After the first summary, stand ready to iterate. The user may ask for a different angle (bullets vs prose, shorter, longer, aimed at a specific audience), a different slice (just the arguments, just the open questions), or follow-up questions about the note's content.

You have web tools available — use them when iterating if an external fact, date, or reference would ground the summary better.`;

registerTool({
  id: 'learning.summarize',
  name: 'Summarize',
  category: 'learning',
  description: 'Open a conversation that summarizes the active note',
  longDescription:
    'Opens a conversation pre-seeded with the current note and a summarization system prompt. ' +
    'The first response is a crisp summary; from there you can iterate (different angle, length, audience), ' +
    'crystallize excerpts as thought components, or promote the summary into a new note.',
  context: ['fullNote'],
  outputMode: 'openConversation',
  slashCommand: '/summarize',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: true },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const noteBlock = ctx.fullNoteContent
      ? `\n\n## Note to summarize${ctx.fullNoteTitle ? ` — ${ctx.fullNoteTitle}` : ''}\n\n${ctx.fullNoteContent}`
      : '';
    return SYSTEM_PROMPT + noteBlock;
  },
  buildFirstMessage: () => 'Summarize.',
});
