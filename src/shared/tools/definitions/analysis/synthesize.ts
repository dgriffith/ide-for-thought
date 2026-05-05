/**
 * Ported from https://github.com/jordanrubin/FUTURE_TOKENS (CC BY 4.0,
 * Jordan Rubin). Prompt body lives in `synthesize.prompt.md`.
 */
import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './synthesize.prompt.md?raw';
import { analysisSourceBlock, analysisFirstMessage } from './_shared';

registerTool({
  id: 'analysis.synthesize',
  name: 'Synthesize',
  category: 'analysis',
  description: 'Compress thesis + antithesis into a unified frame',
  longDescription:
    'Given a thesis and an antithesis, produces a synthesis: a unified frame that preserves the ' +
    "load-bearing insight from each side while resolving the apparent contradiction. The output's " +
    'depth scales with the depth setting — quick gives a one-paragraph compression; deep walks ' +
    "through the dialectical move stage by stage. Pairs with Antithesize.",
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-opus-4-7',
  web: { defaultEnabled: false },
  parameters: [
    {
      id: 'depth',
      label: 'Synthesis depth',
      type: 'select',
      options: [
        { label: 'Quick — one-paragraph compression', value: 'quick' },
        { label: 'Medium — staged dialectical move', value: 'medium' },
        { label: 'Deep — full multi-section synthesis', value: 'deep' },
      ],
      defaultValue: 'medium',
    },
    {
      id: 'audience',
      label: 'Audience',
      type: 'select',
      options: [
        { label: 'Novice — accessible framing', value: 'novice' },
        { label: 'General — informed reader', value: 'general' },
        { label: 'Expert — technical, precise', value: 'expert' },
      ],
      defaultValue: 'general',
    },
  ],
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const depth = ctx.parameterValues?.depth ?? 'medium';
    const audience = ctx.parameterValues?.audience ?? 'general';
    const directive = `\n\nOutput tier: ${depth}.\nAudience: ${audience}.`;
    return SYSTEM_PROMPT + directive + analysisSourceBlock(ctx);
  },
  buildFirstMessage: (ctx: ToolContext) => analysisFirstMessage(ctx, 'synthesize'),
});
