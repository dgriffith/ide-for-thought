/**
 * Ported from https://github.com/jordanrubin/FUTURE_TOKENS (CC BY 4.0,
 * Jordan Rubin). Prompt body lives in `negspace.prompt.md`.
 */
import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './negspace.prompt.md?raw';
import { analysisSourceBlock, analysisFirstMessage } from './_shared';

registerTool({
  id: 'analysis.negspace',
  name: 'Negspace',
  category: 'analysis',
  description: 'Detect what is conspicuously absent',
  longDescription:
    'Reads the source for negative space — the considerations, counterarguments, stakeholders, time ' +
    'horizons, or trade-offs that any honest treatment would address but that the text quietly skips. ' +
    'The output is a list of conspicuous absences, ranked by how much they would matter if surfaced.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: false },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => SYSTEM_PROMPT + analysisSourceBlock(ctx),
  buildFirstMessage: (ctx: ToolContext) => analysisFirstMessage(ctx, 'find the negative space'),
});
