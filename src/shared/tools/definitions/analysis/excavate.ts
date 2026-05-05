import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import PROMPT_BODY from './excavate.prompt.md?raw';

const DEPTH_PROMPTS: Record<string, string> = {
  quick: `Perform a **quick** excavation:
- Generate layer-1 assumptions only (3-7 items answering "what must be true?")
- Tag each as [CRUX], [HIGH-UNCERTAINTY], or [HIGH-LEVERAGE] where applicable
- Summarize the top 3 load-bearing cruxes
- Generate 2-3 probe questions`,
  standard: `Perform a **standard** excavation:
- Generate layer-1 assumptions (3-7 items)
- Recurse downward for 2-3 levels, tagging with [CRUX], [HIGH-UNCERTAINTY], [HIGH-LEVERAGE]
- Categorize each assumption: Empirical, Normative, Structural, Psychological, or Definitional
- Summarize the 3-7 load-bearing cruxes
- Generate probe questions for each crux`,
  deep: `Perform a **deep** excavation:
- Generate layer-1 assumptions (5-7 items)
- Recurse downward for 3-4 levels, tagging with [CRUX], [HIGH-UNCERTAINTY], [HIGH-LEVERAGE]
- Categorize each: Empirical, Normative, Structural, Psychological, or Definitional
- Trace the genealogy of key assumptions — where do they come from? What traditions or experiences produced them?
- Summarize the 3-7 load-bearing cruxes
- Generate probe questions for each crux
- Identify which cruxes are empirically testable vs. value-based`,
};

registerTool({
  id: 'analysis.excavate',
  name: 'Excavate',
  category: 'analysis',
  description: 'Surface hidden assumptions underlying arguments',
  longDescription:
    'Assumption archaeology that maps the hidden assumptions supporting a claim, belief, or plan. ' +
    'Unlike opposition-generation, Excavate surfaces the "skeleton" beneath a stance by repeatedly ' +
    'asking "what must be true for this to make sense?" until reaching axioms or maximum depth.',
  context: ['selectedText', 'fullNote'],
  parameters: [
    {
      id: 'depth',
      label: 'Analysis depth',
      type: 'select',
      options: [
        { label: 'Quick — surface assumptions only', value: 'quick' },
        { label: 'Standard — assumptions + implications', value: 'standard' },
        { label: 'Deep — assumptions + implications + genealogy', value: 'deep' },
      ],
      defaultValue: 'standard',
    },
  ],
  outputMode: 'newNote',
  outputNotePrefix: 'excavate',
  slashCommand: '/excavate',
  buildPrompt: (ctx: ToolContext) => {
    const text = ctx.selectedText || ctx.fullNoteContent || '';
    const depth = ctx.parameterValues?.depth || 'standard';
    const depthInstructions = DEPTH_PROMPTS[depth] || DEPTH_PROMPTS.standard;
    const sourceLabel = ctx.selectedText ? 'Selected Text' : 'Note';
    return `${PROMPT_BODY.replace('{{DEPTH_INSTRUCTIONS}}', depthInstructions)}
## ${sourceLabel}

${text}

Respond in markdown. Use indented lists or tree notation for the assumption layers. Bold the [CRUX] items. End with the probe questions as a numbered list.`;
  },
});
