/**
 * Ported from https://github.com/dgriffith/combat-epistemology (CC BY 4.0).
 * Prompt body lives in `hamming.prompt.md`.
 */
import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './hamming.prompt.md?raw';
import { analysisSourceBlock, analysisFirstMessage } from './_shared';

registerTool({
  id: 'analysis.hamming',
  name: 'Hamming Question',
  category: 'analysis',
  description: 'Surface the most-important problem you are not working on',
  longDescription:
    'Applies Richard Hamming\'s question — what are the most important problems in your field, and ' +
    'why aren\'t you working on them? — to the source. Output is the highest-leverage problem the ' +
    'source either ignores or under-prioritises, plus the reasons it might be getting avoided. ' +
    'Useful for portfolio-style decisions and yearly reviews.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-opus-4-7',
  web: { defaultEnabled: false },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => SYSTEM_PROMPT + analysisSourceBlock(ctx),
  buildFirstMessage: (ctx: ToolContext) => analysisFirstMessage(ctx, 'apply the Hamming question'),
});
