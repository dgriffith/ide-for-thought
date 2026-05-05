/**
 * Ported from https://github.com/jordanrubin/FUTURE_TOKENS (CC BY 4.0,
 * Jordan Rubin). Prompt body lives in `metaphorize.prompt.md`.
 */
import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './metaphorize.prompt.md?raw';
import { analysisSourceBlock, analysisFirstMessage } from './_shared';

registerTool({
  id: 'analysis.metaphorize',
  name: 'Metaphorize',
  category: 'analysis',
  description: 'High-coverage source→target domain mapping',
  longDescription:
    'Builds a structured metaphor: maps elements of the source domain (the thing you understand) onto ' +
    'a target domain (the thing you\'re trying to understand) and reports both what the metaphor ' +
    'illuminates and where it breaks down. Pairs with Rhyme: rhyme is "what does this look like?", ' +
    'metaphorize is "what would it look like through this lens?".',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: false },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => SYSTEM_PROMPT + analysisSourceBlock(ctx),
  buildFirstMessage: (ctx: ToolContext) => analysisFirstMessage(ctx, 'build the metaphor'),
});
