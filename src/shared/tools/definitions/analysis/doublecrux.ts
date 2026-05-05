/**
 * Ported from https://github.com/dgriffith/combat-epistemology (CC BY 4.0).
 * Prompt body lives in `doublecrux.prompt.md`.
 */
import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './doublecrux.prompt.md?raw';
import { analysisSourceBlock, analysisFirstMessage } from './_shared';

registerTool({
  id: 'analysis.doublecrux',
  name: 'Double Crux',
  category: 'analysis',
  description: 'Find the shared crux that would resolve a disagreement',
  longDescription:
    'Walks two positions back to a shared crux: the proposition both sides would update on if shown ' +
    'evidence about. Output is the crux statement plus what evidence would move each side and which ' +
    'cruxes are empirical vs definitional vs values-based. Reach for this when a disagreement is ' +
    'going in circles and you suspect the parties are arguing past each other.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-opus-4-7',
  web: { defaultEnabled: false },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => SYSTEM_PROMPT + analysisSourceBlock(ctx),
  buildFirstMessage: (ctx: ToolContext) => analysisFirstMessage(ctx, 'find the double crux'),
});
