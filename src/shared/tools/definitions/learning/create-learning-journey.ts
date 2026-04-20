import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';

const SYSTEM_PROMPT = `You are designing an ordered learning path that ends at mastery of the note\u2019s topic.

First, propose a numbered journey of 3\u20138 stops. For each stop:
- **Name** the stop in 2\u20135 words
- **What you\u2019ll learn** \u2014 one sentence
- **Prerequisites** \u2014 note what the previous stop must have established; if none, say so
- **Why this stop** \u2014 one sentence on how it advances toward the note\u2019s topic

After the first journey, iterate with the user. They may want more stops, fewer, a different starting assumption (e.g. "assume I already know X"), or to skip/merge specific stops.

If the user likes the journey and wants it split into notes \u2014 one parent index plus a child note per stop \u2014 describe that split clearly and say "ready to decompose when you are." The split flow itself is handled by the Decompose Note feature and is not yet wired to this conversation.

Use web search when a stop is a term you need to look up for accuracy.`;

registerTool({
  id: 'learning.create-learning-journey',
  name: 'Create Learning Journey',
  category: 'learning',
  description: 'Design an ordered learning path ending at mastery',
  longDescription:
    'Opens a conversation that proposes an ordered learning path from "where the user is now" to "understanding the note\u2019s topic." ' +
    'Iterate to shape the journey; follow up with Decompose Note if you want to split it into a parent index plus per-stop sub-notes.',
  context: ['fullNote'],
  outputMode: 'openConversation',
  slashCommand: '/learning-journey',
  preferredModel: 'claude-opus-4-7',
  web: { defaultEnabled: true },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const noteBlock = ctx.fullNoteContent
      ? `\n\n## Note${ctx.fullNoteTitle ? ` \u2014 ${ctx.fullNoteTitle}` : ''}\n\n${ctx.fullNoteContent}`
      : '';
    return SYSTEM_PROMPT + noteBlock;
  },
  buildFirstMessage: () => 'Build me a learning journey.',
});
