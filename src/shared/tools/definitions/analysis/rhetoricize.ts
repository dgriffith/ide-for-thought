/**
 * Ported from https://github.com/jordanrubin/FUTURE_TOKENS (CC BY 4.0,
 * Jordan Rubin). Prompt body lives in `rhetoricize.prompt.md`.
 */
import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './rhetoricize.prompt.md?raw';
import { analysisSourceBlock, analysisFirstMessage } from './_shared';

registerTool({
  id: 'analysis.rhetoricize',
  name: 'Rhetoricize',
  category: 'analysis',
  description: 'Map the rhetorical "spin-space" — where could the argument pivot?',
  longDescription:
    'Diagnoses the fulcrum points in an argument: words and framings doing rhetorical work, places ' +
    'where a small reframe would flip the conclusion, the spectrum of plausible spins from the same ' +
    'underlying facts. Useful when you suspect a piece is doing more persuasive than analytic work.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: false },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => SYSTEM_PROMPT + analysisSourceBlock(ctx),
  buildFirstMessage: (ctx: ToolContext) => analysisFirstMessage(ctx, 'map the rhetorical spin-space'),
});
