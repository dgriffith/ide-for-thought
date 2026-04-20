import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';

const SYSTEM_PROMPT = `You are finding where the note\u2019s claims break down.

Identify edge cases, failure modes, historical exceptions, or scenarios where reasonable readers should disagree. For each:
- state the counterexample crisply
- give one sentence on why the claim falters there

Draw from web search when a real-world case would strengthen the counterexample. Rank from most damaging to most marginal. After the first list, iterate with the user \u2014 they may want to dig into one counterexample, generate more in a particular category, or steelman the original claim back against the counterexamples.`;

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
