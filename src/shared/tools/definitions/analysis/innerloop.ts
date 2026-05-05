/**
 * Ported from https://github.com/dgriffith/combat-epistemology (CC BY 4.0).
 * Prompt body lives in `innerloop.prompt.md`.
 */
import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './innerloop.prompt.md?raw';
import { analysisSourceBlock, analysisFirstMessage } from './_shared';

registerTool({
  id: 'analysis.innerloop',
  name: 'Inner Loop',
  category: 'analysis',
  description: 'Sim the plan from the inside — what would actually happen?',
  longDescription:
    'Mentally simulates a plan or scenario from the inside, step by step, surfacing the friction ' +
    "points the outside view tends to gloss. Output is a step-by-step inner monologue plus the moments " +
    'where the simulation predicts a stumble and the user would course-correct in practice. ' +
    'Complements murphyjitsu (failure-mode listing) — innerloop is "play it forward".',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: false },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => SYSTEM_PROMPT + analysisSourceBlock(ctx),
  buildFirstMessage: (ctx: ToolContext) => analysisFirstMessage(ctx, 'sim the inner loop'),
});
