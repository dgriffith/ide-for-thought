import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import PROMPT_BODY from './taboo.prompt.md?raw';

registerTool({
  id: 'planning.taboo',
  name: 'Taboo',
  category: 'analysis',
  description: 'Semantic decomposition by banning a contested term',
  longDescription:
    'Forces clarity by banning a word and requiring restatement without it. ' +
    'Reveals whether disagreements are real or merely linguistic, and unpacks ' +
    'the hidden assumptions bundled into abstract or contested terms.',
  context: ['selectedText', 'fullNote'],
  parameters: [
    {
      id: 'term',
      label: 'Word or phrase to taboo',
      type: 'text',
      placeholder: 'e.g. "consciousness", "fair", "intelligence"',
      required: true,
    },
  ],
  outputMode: 'newNote',
  outputNotePrefix: 'taboo',
  slashCommand: '/taboo',
  buildPrompt: (ctx: ToolContext) => {
    const text = ctx.selectedText || ctx.fullNoteContent || '';
    const term = ctx.parameterValues?.term || '[unspecified term]';
    const sourceLabel = ctx.selectedText ? 'Selected Text' : 'Note';
    return `${PROMPT_BODY.replace(/\{\{TERM\}\}/g, term)}
## ${sourceLabel}

${text}

Respond in markdown. Structure with clear headings for each step. End with a "Diagnostic Summary" that states what real disagreement (if any) remains after the semantic unpacking.`;
  },
});
