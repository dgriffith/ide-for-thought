import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './summarize.prompt.md?raw';

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
