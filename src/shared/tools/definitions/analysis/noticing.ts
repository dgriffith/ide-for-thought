/**
 * Ported from https://github.com/dgriffith/combat-epistemology (CC BY 4.0).
 * Prompt body lives in `noticing.prompt.md`.
 */
import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './noticing.prompt.md?raw';
import { analysisSourceBlock, analysisFirstMessage } from './_shared';

registerTool({
  id: 'analysis.noticing',
  name: 'Noticing',
  category: 'analysis',
  description: 'Surface the felt sense the prose isn\'t saying out loud',
  longDescription:
    'Reads the source for the things the writer is sensing but not yet articulating — confusion, ' +
    'disagreement, hesitation, excitement, surprise. Output names each noticed felt sense, points ' +
    'at the textual evidence for it, and asks one or two questions that would make the noticed ' +
    'thing legible. Useful when prose feels like it\'s circling something it can\'t quite say.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: false },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => SYSTEM_PROMPT + analysisSourceBlock(ctx),
  buildFirstMessage: (ctx: ToolContext) => analysisFirstMessage(ctx, 'name what is being noticed'),
});
