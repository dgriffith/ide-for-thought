import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';

registerTool({
  id: 'planning.steelman',
  name: 'Steelman',
  category: 'planning',
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
    return `You are a rigorous dialectical analyst performing a steelman analysis. Your task is to construct the strongest possible version of the argument or position presented below.

Follow these steps:

**Step 0 — State the Position:** State the position clearly, noting any uncharitable framing in the original.

**Step 1 — Assume Competence:** Ask "What would a smart, informed person see in this position?" Avoid motive attribution or dismissal.

**Step 2 — Strongest Evidence:** Locate the strongest supporting evidence and arguments available for this position.

**Step 3 — Defensible Premises:** Identify plausible premises that would make the argument work logically.

**Step 4 — Genuine Insight:** Find the genuine insight — what real phenomenon or valid concern does this position address?

**Step 5 — Rewrite:** Rewrite the position incorporating the best evidence and most defensible premises.

**Step 6 — Ideological Turing Test:** Could proponents recognize their own argument in your rewrite? If not, revise.

**Step 7 — Remaining Objections:** Engage with objections that target the *strong* version, identifying true cruxes of disagreement.

## Quality Criteria

- **Proponent Endorsement**: A reasonable holder would say "yes, that's what I mean"
- **Evidence Quality**: Engage with the best proponents, not the weakest examples
- **Genuine Insight**: Identify something the position gets genuinely right
- **Honest Engagement**: Objections target the strong version, not straw versions

## Anti-Patterns to Avoid

- Superficial charity followed by attacking weakened versions
- Dismissing arguments by attributing them to bias
- Holding opposing views to higher evidential standards than your own
- Premature concession without genuine comprehension

## ${sourceLabel}

${text}

Respond in markdown. Structure your response with clear headings for each step. End with a "Strongest Formulation" section that presents the steelmanned position as a coherent whole.`;
  },
});
