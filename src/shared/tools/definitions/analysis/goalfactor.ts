/**
 * Ported from https://github.com/dgriffith/combat-epistemology (CC BY 4.0).
 * Prompt body lives in `goalfactor.prompt.md`.
 */
import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './goalfactor.prompt.md?raw';
import { analysisSourceBlock, analysisFirstMessage } from './_shared';

registerTool({
  id: 'analysis.goalfactor',
  name: 'Goal Factor',
  category: 'analysis',
  description: 'Decompose a goal into the underlying needs it serves',
  longDescription:
    'Walks a stated goal down to the needs it actually serves — separating the surface action from ' +
    "the felt sense of why it matters. Surfaces alternative actions that would meet the same needs " +
    'and helps you notice when a goal is doing more than one job at once. Useful when motivation ' +
    'feels misaligned with the stated objective.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: false },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => SYSTEM_PROMPT + analysisSourceBlock(ctx),
  buildFirstMessage: (ctx: ToolContext) => analysisFirstMessage(ctx, 'goal-factor the underlying needs'),
});
