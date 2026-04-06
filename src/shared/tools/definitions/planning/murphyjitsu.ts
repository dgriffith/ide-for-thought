import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';

registerTool({
  id: 'planning.murphyjitsu',
  name: 'Murphyjitsu',
  category: 'planning',
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
    return `You are performing a Murphyjitsu analysis — a pre-mortem failure simulation technique. Your brain already knows this plan will fail. This is the extraction protocol.

## The Process

**Step 1 — State success clearly.** Define the scope, timeline, and success criteria for the plan described below.

**Step 2 — Invoke temporal inversion.** "It's [appropriate timeframe] from now. The plan has completely failed." Commit to this frame.

**Step 3 — Generate failure stories.** Produce 5-10 concrete, specific ways the plan fails. Cover three categories:
- **Execution failures** — didn't follow through, dropped the ball, lost momentum
- **Assumption failures** — the world wasn't as expected, key premises were wrong
- **External shocks** — events beyond control that derailed everything

**Step 4 — Apply the surprise-o-meter.** For each failure mode, honestly assess: "Would I be surprised if this happened?" Rate as Low / Medium / High surprise. Low-surprise modes are real risks you're underweighting.

**Step 5 — Build mitigations.** For each significant failure mode, specify:
- **Prevention** — concrete action to reduce probability
- **Detection** — how you'd notice it happening early
- **Response** — what to do if it happens anyway

**Step 6 — Identify residual risks.** Name what can't be fully mitigated. Don't pretend all risks disappear.

## Quality Criteria

- **Failure mode coverage**: 5+ distinct scenarios across all three categories
- **Surprise calibration**: Honest assessment, not performative confidence
- **Mitigation quality**: Concrete and actionable, not "we'll be more careful"
- **Residual acknowledgment**: Explicitly name remaining risks

## Anti-Patterns to Avoid

- **Vague narratives**: "Something went wrong" lacks the specificity needed for analysis
- **Execution-only focus**: Wrong assumptions can derail a perfectly executed plan
- **Mitigation theater**: "Try harder" isn't a mitigation — specify actions and checkpoints
- **Residual denial**: Pretending all risks disappear signals self-deception

## ${sourceLabel}

${text}

Respond in markdown. Use a table for the failure modes with columns: Failure Mode | Category | Surprise Rating | Key Mitigation. Follow with detailed mitigation plans and a Residual Risks section.`;
  },
});
