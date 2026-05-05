import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './find-prerequisites.prompt.md?raw';

registerTool({
  id: 'learning.find-prerequisites',
  name: 'Find Prerequisites',
  category: 'learning',
  description: 'List concepts to understand before tackling this note',
  longDescription:
    'Opens a conversation that lists the concepts, facts, or skills a reader should understand before tackling the active note. ' +
    'Ordered from most fundamental to closest-adjacent, with a one-sentence rationale per item.',
  context: ['fullNote'],
  outputMode: 'openConversation',
  slashCommand: '/prerequisites',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: true },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const noteBlock = ctx.fullNoteContent
      ? `\n\n## Note${ctx.fullNoteTitle ? ` \u2014 ${ctx.fullNoteTitle}` : ''}\n\n${ctx.fullNoteContent}`
      : '';
    return SYSTEM_PROMPT + noteBlock;
  },
  buildFirstMessage: () => 'What should I know before reading this?',
});
