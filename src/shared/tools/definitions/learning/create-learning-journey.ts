import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT_WITH_NOTE from './create-learning-journey.prompt.md?raw';
import SYSTEM_PROMPT_NO_NOTE from './create-learning-journey.no-note.prompt.md?raw';

registerTool({
  id: 'learning.create-learning-journey',
  name: 'Create Learning Journey',
  category: 'learning',
  description: 'Design an ordered learning path ending at mastery',
  longDescription:
    'Opens a conversation that proposes an ordered learning path from "where the user is now" to "understanding the destination topic." ' +
    'When a note is open the destination defaults to that note; otherwise the assistant asks what topic to learn. ' +
    'Iterate to shape the journey, then ask the assistant to file it as a parent index note + one child note per stop — reviewed inline as a single Proposal.',
  // Context is advisory: when fullNoteContent is missing the prompt adapts.
  context: ['fullNote'],
  outputMode: 'openConversation',
  slashCommand: '/learning-journey',
  preferredModel: 'claude-opus-4-7',
  web: { defaultEnabled: true },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    if (!ctx.fullNoteContent) return SYSTEM_PROMPT_NO_NOTE;
    const noteBlock = `\n\n## Note${ctx.fullNoteTitle ? ` — ${ctx.fullNoteTitle}` : ''}\n\n${ctx.fullNoteContent}`;
    return SYSTEM_PROMPT_WITH_NOTE + noteBlock;
  },
  buildFirstMessage: (ctx: ToolContext) => {
    // Without a note the assistant should ask for the destination first;
    // an auto-fired "Build me a learning journey" would force it to invent
    // the destination, which is exactly the friction we're trying to avoid.
    if (!ctx.fullNoteContent) return '';
    return 'Build me a learning journey.';
  },
});
