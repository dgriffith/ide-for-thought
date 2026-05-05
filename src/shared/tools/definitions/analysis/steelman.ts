import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import PROMPT_BODY from './steelman.prompt.md?raw';

registerTool({
  id: 'planning.steelman',
  name: 'Steelman',
  category: 'analysis',
  description: 'Construct the strongest version of an opposing argument',
  longDescription:
    'Builds the strongest possible version of a position by assuming intelligent proponents, ' +
    'finding genuine insights, and engaging with the best available evidence. ' +
    'If you can\'t state the opposing position in a way its proponents would endorse, ' +
    'you don\'t understand it well enough to reject it.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'newNote',
  outputNotePrefix: 'steelman',
  slashCommand: '/steelman',
  buildPrompt: (ctx: ToolContext) => {
    const text = ctx.selectedText || ctx.fullNoteContent || '';
    const sourceLabel = ctx.selectedText ? 'Selected Text' : 'Note';
    return `${PROMPT_BODY}
## ${sourceLabel}

${text}

Respond in markdown. Structure your response with clear headings for each step. End with a "Strongest Formulation" section that presents the steelmanned position as a coherent whole.`;
  },
});
