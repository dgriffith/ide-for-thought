/**
 * Ported from https://github.com/jordanrubin/FUTURE_TOKENS (CC BY 4.0,
 * Jordan Rubin). Prompt body lives in `antithesize.prompt.md`.
 */
import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './antithesize.prompt.md?raw';
import { analysisSourceBlock, analysisFirstMessage } from './_shared';

registerTool({
  id: 'analysis.antithesize',
  name: 'Antithesize',
  category: 'analysis',
  description: 'Generate a standalone opposition — a complete rival worldview',
  longDescription:
    'Produces an antithesis that stands on its own — comprehensible without reading the original ' +
    'thesis. Not refutation; an alternative complete worldview. Pairs with Steelman (which strengthens ' +
    "the original) and Synthesize (which compresses thesis + antithesis into a unified frame). Use a " +
    'higher intensity to push the opposition further from the original.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-opus-4-7',
  web: { defaultEnabled: false },
  parameters: [
    {
      id: 'intensity',
      label: 'Intensity',
      type: 'select',
      options: [
        { label: 'Gentle — civil disagreement, shared frame', value: 'gentle' },
        { label: 'Standard — strong opposition, fair fight', value: 'standard' },
        { label: 'Adversarial — push to the far edge of plausibility', value: 'adversarial' },
      ],
      defaultValue: 'standard',
    },
  ],
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const intensity = ctx.parameterValues?.intensity ?? 'standard';
    const directive = `\n\nContract: ${intensity}. ` + intensityDirective(intensity);
    return SYSTEM_PROMPT + directive + analysisSourceBlock(ctx);
  },
  buildFirstMessage: (ctx: ToolContext) => analysisFirstMessage(ctx, 'generate the antithesis'),
});

function intensityDirective(value: string): string {
  switch (value) {
    case 'gentle':
      return 'Stay within a shared analytic frame — disagree civilly, not destructively. The author would still recognise the disagreement as fair.';
    case 'adversarial':
      return 'Push the opposition to the far edge of plausibility. The author should find this view alien but not strawmanned. Identity-attacking moves are fine if they cut at real assumptions.';
    case 'standard':
    default:
      return 'Strong opposition, fair fight. The opposition should be load-bearing and complete, not tactical jabs.';
  }
}
