/**
 * Ported from https://github.com/jordanrubin/FUTURE_TOKENS (CC BY 4.0,
 * Jordan Rubin). Prompt body lives in `rhyme.prompt.md` verbatim per the
 * upstream skill.
 */
import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './rhyme.prompt.md?raw';
import { analysisSourceBlock, analysisFirstMessage } from './_shared';

registerTool({
  id: 'analysis.rhyme',
  name: 'Rhyme',
  category: 'analysis',
  description: 'Fast structural-similarity recognition — what does this echo?',
  longDescription:
    'Surfaces structural rhymes — past situations, historical patterns, or analogues whose shape ' +
    'resembles the source. Pairs with Metaphorize: rhyme is recognition, metaphorize is mapping. ' +
    'Reach for this when you want quick "this looks like…" matches before committing to a full analogy.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: true },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => SYSTEM_PROMPT + analysisSourceBlock(ctx),
  buildFirstMessage: (ctx: ToolContext) => analysisFirstMessage(ctx, 'find the rhymes'),
});
