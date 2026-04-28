import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';

const SYSTEM_PROMPT_WITH_NOTE = `You are building a glossary for the note the user is working in.

Extract jargon, proper nouns, and technical terms that would genuinely puzzle someone new to the topic. Skip terms the note already defines inline. For each:
- the term
- a one-sentence working definition
- (if useful) a "not to be confused with" disambiguation

Use web lookup when you need a canonical definition. After the first glossary, iterate — the user may want more or fewer entries, deeper definitions, or clarification on specific terms.

When the user wants the glossary filed, call the propose_notes tool with the bundle. Two reasonable shapes:
- One note containing all terms as a glossary (cleanest for short lists).
- One parent index + one note per term (when terms warrant their own pages).

The user reviews the bundle as an inline card. Don't paste the contents inline in chat too — the card is the deliverable.`;

const SYSTEM_PROMPT_NO_NOTE = `You are building a glossary for a topic the user wants to understand.

Because no note is open, your FIRST response should be a short clarifying question: what topic or domain do you want a glossary for? Don't propose terms yet.

Once the topic is clear, extract jargon, proper nouns, and technical terms a newcomer would struggle with. For each:
- the term
- a one-sentence working definition
- (if useful) a "not to be confused with" disambiguation

Use web lookup when you need a canonical definition. After the first glossary, iterate.

When the user wants the glossary filed, call the propose_notes tool with the bundle. Two reasonable shapes:
- One note containing all terms as a glossary (cleanest for short lists).
- One parent index + one note per term (when terms warrant their own pages).

The user reviews the bundle as an inline card. Don't paste the contents inline in chat too — the card is the deliverable.`;

registerTool({
  id: 'learning.define-terms',
  name: 'Define Terms',
  category: 'learning',
  description: 'Extract and define jargon from a note or topic',
  longDescription:
    'Opens a conversation that extracts jargon, proper nouns, and technical terms and defines each. ' +
    'Works on the active note when one is open; otherwise asks you what topic to build a glossary for. ' +
    'Iterate if definitions are off or terms are missing, then ask the assistant to file the glossary as one or more notes.',
  context: ['fullNote'],
  outputMode: 'openConversation',
  slashCommand: '/define-terms',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: true },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    if (!ctx.fullNoteContent) return SYSTEM_PROMPT_NO_NOTE;
    const noteBlock = `\n\n## Note${ctx.fullNoteTitle ? ` — ${ctx.fullNoteTitle}` : ''}\n\n${ctx.fullNoteContent}`;
    return SYSTEM_PROMPT_WITH_NOTE + noteBlock;
  },
  buildFirstMessage: (ctx: ToolContext) => {
    // Without a note, an auto-fired "Define the terms in this note" forces
    // the model to invent context. Empty firstMessage opens a clean chat.
    if (!ctx.fullNoteContent) return '';
    return 'Define the terms in this note.';
  },
});
