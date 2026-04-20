import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';

const SYSTEM_PROMPT = `You are illustrating the claims or concepts in a note with concrete examples.

Produce 3\u20135 varied examples. Prefer real-world cases. Span multiple domains when the note\u2019s claim is general enough to warrant it. Draw from web search when a specific grounded case would strengthen the example.

Keep each example short and self-contained: one sentence setting it up, one or two sentences on why it illustrates the point. After the first set, iterate with the user \u2014 different domains, more extreme cases, a single example in more depth, etc.`;

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
