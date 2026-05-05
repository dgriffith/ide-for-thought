/**
 * Ported from https://github.com/jordanrubin/FUTURE_TOKENS (CC BY 4.0,
 * Jordan Rubin). Prompt body lives in `inductify.prompt.md`.
 */
import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './inductify.prompt.md?raw';
import { analysisSourceBlock, analysisFirstMessage } from './_shared';

registerTool({
  id: 'analysis.inductify',
  name: 'Inductify',
  category: 'analysis',
  description: 'Cross-example pattern extraction — what underlies these cases?',
  longDescription:
    'Given several cases, examples, or anecdotes, extracts the unifying pattern behind them. Output is ' +
    'a stated regularity plus the cases it covers and the cases that resist it — calibrated, not ' +
    'sweeping. Reach for this when you have a pile of "kinda similar" things and need to name what ' +
    'actually links them.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: false },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => SYSTEM_PROMPT + analysisSourceBlock(ctx),
  buildFirstMessage: (ctx: ToolContext) => analysisFirstMessage(ctx, 'extract the inductive pattern'),
});
