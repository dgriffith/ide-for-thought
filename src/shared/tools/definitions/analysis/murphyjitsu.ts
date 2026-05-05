import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import PROMPT_BODY from './murphyjitsu.prompt.md?raw';

registerTool({
  id: 'planning.murphyjitsu',
  name: 'Murphyjitsu',
  category: 'analysis',
  description: 'Pre-mortem failure analysis for plans and decisions',
  longDescription:
    'Treats failure as historical fact and works backward to generate concrete failure narratives. ' +
    'By inverting time — "It\'s six months from now. Total failure." — your brain\'s inner simulator ' +
    'bypasses optimism bias and reveals genuine vulnerabilities.',
  context: ['selectedText', 'fullNote'],
  parameters: [
    {
      id: 'plan',
      label: 'Plan to analyze (leave blank to use the note content)',
      type: 'textarea',
      placeholder: 'Describe the plan, project, or decision you want to stress-test...',
    },
  ],
  outputMode: 'newNote',
  outputNotePrefix: 'murphyjitsu',
  slashCommand: '/murphyjitsu',
  buildPrompt: (ctx: ToolContext) => {
    const planParam = ctx.parameterValues?.plan?.trim();
    const text = planParam || ctx.selectedText || ctx.fullNoteContent || '';
    const sourceLabel = planParam ? 'Plan Description' : (ctx.selectedText ? 'Selected Text' : 'Note');
    return `${PROMPT_BODY}
## ${sourceLabel}

${text}

Respond in markdown. Use a table for the failure modes with columns: Failure Mode | Category | Surprise Rating | Key Mitigation. Follow with detailed mitigation plans and a Residual Risks section.`;
  },
});
