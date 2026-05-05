/**
 * Ported from https://github.com/jordanrubin/FUTURE_TOKENS (CC BY 4.0,
 * Jordan Rubin). Prompt body lives in `dimensionalize.prompt.md`.
 */
import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './dimensionalize.prompt.md?raw';
import { analysisSourceBlock, analysisFirstMessage } from './_shared';

registerTool({
  id: 'analysis.dimensionalize',
  name: 'Dimensionalize',
  category: 'analysis',
  description: 'Reduce a decision to 3-7 measurable dimensions',
  longDescription:
    'Pulls the load-bearing dimensions out of a fuzzy decision or comparison: 3-7 axes you could ' +
    'actually measure or rank along. Each dimension comes with what it would mean to score "high" or ' +
    '"low" and which existing arguments engage it. Reach for this before evaluating options head-to-head.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: false },
  parameters: [
    {
      id: 'target_count',
      label: 'Target dimension count',
      type: 'select',
      options: [
        { label: 'Tight — 3 dimensions', value: '3' },
        { label: 'Standard — 5 dimensions', value: '5' },
        { label: 'Generous — 7 dimensions', value: '7' },
      ],
      defaultValue: '5',
    },
  ],
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const target = ctx.parameterValues?.target_count ?? '5';
    const directive = `\n\nTarget dimension count: aim for ~${target}; deviate only if the source genuinely demands more or fewer.`;
    return SYSTEM_PROMPT + directive + analysisSourceBlock(ctx);
  },
  buildFirstMessage: (ctx: ToolContext) => analysisFirstMessage(ctx, 'extract the dimensions'),
});
