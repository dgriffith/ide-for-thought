import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './find-counterexamples.prompt.md?raw';

registerTool({
  id: 'learning.find-counterexamples',
  name: 'Find Counterexamples',
  category: 'learning',
  description: 'Where does this note\u2019s argument break down?',
  longDescription:
    'Opens a conversation that generates edge cases, failure modes, and situations where the note\u2019s claims break down. ' +
    'Ordered from most damaging to most marginal, each with a brief reason.',
  context: ['fullNote'],
  outputMode: 'openConversation',
  slashCommand: '/counterexamples',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: true },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const noteBlock = ctx.fullNoteContent
      ? `\n\n## Note${ctx.fullNoteTitle ? ` \u2014 ${ctx.fullNoteTitle}` : ''}\n\n${ctx.fullNoteContent}`
      : '';
    return SYSTEM_PROMPT + noteBlock;
  },
  buildFirstMessage: () => 'Where does this break down?',
});
