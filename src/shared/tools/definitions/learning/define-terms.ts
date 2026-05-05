import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT_WITH_NOTE from './define-terms.prompt.md?raw';
import SYSTEM_PROMPT_NO_NOTE from './define-terms.no-note.prompt.md?raw';

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
