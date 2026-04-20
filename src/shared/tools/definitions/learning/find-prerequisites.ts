import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';

const SYSTEM_PROMPT = `You are mapping what a reader needs to know before the note below will make sense.

Identify the concepts, facts, or skills a reader needs in hand. Order from most fundamental to closest-adjacent. For each, give one sentence on why it\u2019s prerequisite \u2014 what the note assumes the reader already has.

Use web search when a prerequisite is itself a technical term you need to look up. After the first list, iterate with the user \u2014 they may want a shorter curriculum, more depth on one prerequisite, or pointers to resources for learning it.`;

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
