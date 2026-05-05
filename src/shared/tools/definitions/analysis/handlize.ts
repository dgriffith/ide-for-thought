/**
 * Ported from https://github.com/jordanrubin/FUTURE_TOKENS (CC BY 4.0,
 * Jordan Rubin). Prompt body lives in `handlize.prompt.md`.
 */
import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './handlize.prompt.md?raw';
import { analysisSourceBlock, analysisFirstMessage } from './_shared';

registerTool({
  id: 'analysis.handlize',
  name: 'Handlize',
  category: 'analysis',
  description: 'Extract operational "handles" — short phrases you can grab and use',
  longDescription:
    'Pulls operational handles out of arguments or narratives — short, memorable phrases that compress ' +
    'a load-bearing idea so you can wield it later. Think Pithy-Stickers, not summaries: each handle ' +
    'is a one-line lever you can apply to other situations.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: false },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => SYSTEM_PROMPT + analysisSourceBlock(ctx),
  buildFirstMessage: (ctx: ToolContext) => analysisFirstMessage(ctx, 'extract the handles'),
});
