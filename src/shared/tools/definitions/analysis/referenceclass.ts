/**
 * Ported from https://github.com/dgriffith/combat-epistemology (CC BY 4.0).
 * Prompt body lives in `referenceclass.prompt.md` from the upstream
 * SKILL.md verbatim.
 */
import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './referenceclass.prompt.md?raw';
import { analysisSourceBlock, analysisFirstMessage } from './_shared';

registerTool({
  id: 'analysis.referenceclass',
  name: 'Reference Class',
  category: 'analysis',
  description: 'Forecast via base rates from the right outside view',
  longDescription:
    'Forces an outside view: pick a reference class of similar past situations, surface their base ' +
    'rate, then check whether the current case has any features that should move the estimate off ' +
    'that rate. Reach for this when an estimate or prediction is in the air and "this time is ' +
    'different" thinking is doing more work than the inside view warrants.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: true },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => SYSTEM_PROMPT + analysisSourceBlock(ctx),
  buildFirstMessage: (ctx: ToolContext) => analysisFirstMessage(ctx, 'find the reference class'),
});
