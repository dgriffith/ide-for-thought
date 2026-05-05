/**
 * Ported from https://github.com/dgriffith/combat-epistemology (CC BY 4.0).
 * Prompt body lives in `aversionfactor.prompt.md`.
 */
import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './aversionfactor.prompt.md?raw';
import { analysisSourceBlock, analysisFirstMessage } from './_shared';

registerTool({
  id: 'analysis.aversionfactor',
  name: 'Aversion Factor',
  category: 'analysis',
  description: 'Decompose a stated objection into the underlying aversions',
  longDescription:
    'Inverse of goal-factor: takes a stated objection or hesitation and walks it down to the actual ' +
    'aversions driving it. Output names the aversion crisply, identifies which actions would actually ' +
    "address it (vs. accommodate it), and flags when a stated reason is doing motivated cover for a " +
    'different felt sense.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: false },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => SYSTEM_PROMPT + analysisSourceBlock(ctx),
  buildFirstMessage: (ctx: ToolContext) => analysisFirstMessage(ctx, 'aversion-factor the underlying objection'),
});
