import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './give-examples.prompt.md?raw';

registerTool({
  id: 'learning.give-examples',
  name: 'Give Examples',
  category: 'learning',
  description: 'Generate concrete examples illustrating the note',
  longDescription:
    'Opens a conversation that produces 3\u20135 concrete, varied examples of the claims or concepts in the active note. ' +
    'Iterate if the examples miss the point or if you want them from a different domain.',
  context: ['fullNote'],
  outputMode: 'openConversation',
  slashCommand: '/examples',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: true },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const noteBlock = ctx.fullNoteContent
      ? `\n\n## Note${ctx.fullNoteTitle ? ` \u2014 ${ctx.fullNoteTitle}` : ''}\n\n${ctx.fullNoteContent}`
      : '';
    return SYSTEM_PROMPT + noteBlock;
  },
  buildFirstMessage: () => 'Give me examples.',
});
