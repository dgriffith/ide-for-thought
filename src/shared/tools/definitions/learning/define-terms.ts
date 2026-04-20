import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';

const SYSTEM_PROMPT = `You are building a glossary for the note the user is working in.

Extract jargon, proper nouns, and technical terms that would genuinely puzzle someone new to the topic. Skip terms the note already defines inline. For each:
- the term
- a one-sentence working definition
- (if useful) a "not to be confused with" disambiguation

Use web lookup when you need a canonical definition. After the first glossary, iterate \u2014 the user may want more or fewer entries, deeper definitions, or clarification on specific terms.`;

registerTool({
  id: 'learning.define-terms',
  name: 'Define Terms',
  category: 'learning',
  description: 'Extract and define jargon from the note',
  longDescription:
    'Opens a conversation that extracts jargon, proper nouns, and technical terms from the active note and defines each. ' +
    'Skips terms defined inline in the note. Iterate if definitions are off or terms are missing.',
  context: ['fullNote'],
  outputMode: 'openConversation',
  slashCommand: '/define-terms',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: true },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const noteBlock = ctx.fullNoteContent
      ? `\n\n## Note${ctx.fullNoteTitle ? ` \u2014 ${ctx.fullNoteTitle}` : ''}\n\n${ctx.fullNoteContent}`
      : '';
    return SYSTEM_PROMPT + noteBlock;
  },
  buildFirstMessage: () => 'Define the terms in this note.',
});
