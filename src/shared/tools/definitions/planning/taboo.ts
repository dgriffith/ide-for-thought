import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';

registerTool({
  id: 'planning.taboo',
  name: 'Taboo',
  category: 'planning',
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
    return `You are performing a Taboo analysis — a semantic decomposition technique. The word "${term}" is now **banned**. It cannot appear in your analysis.

## The Process

1. **Identify what "${term}" is doing** in the source text. What work is this word performing? What claims, values, or boundaries does it bundle together?

2. **Declare the ban.** The word "${term}" is forbidden in all subsequent discussion.

3. **Unpack and restate** the arguments from the source text without using "${term}". Break down the bundled components:
   - Descriptive/factual claims
   - Value judgments
   - Category boundaries
   - Causal mechanisms

4. **Surface hidden assumptions** that the word was concealing. What premises were hiding behind the abstraction?

5. **Diagnose the disagreement** (if any). Is the dispute:
   - Merely verbal (different definitions, same substance)?
   - Genuinely substantive (real disagreement on facts or values)?
   - A mix (some verbal, some real)?

## Quality Criteria

- **The banned term must not appear** in your explanation
- **Use concrete, specific language** — no synonym-swapping with equally abstract words
- **Surface assumptions** — make hidden premises visible
- **Separate factual claims from value judgments**
- **Be diagnostic** — reveal whether disagreement is verbal or substantive

## Anti-Patterns to Avoid

- **Synonym swapping**: Replacing "${term}" with an equally vague word accomplishes nothing
- **Dictionary recitation**: Generic definitions miss the point — demand specificity about meaning in *this* context
- **Scope creep**: Focus on "${term}" first; don't spiral into unpacking every abstract word
- **Weaponization**: This is for clarity, not rhetorical advantage

## ${sourceLabel}

${text}

Respond in markdown. Structure with clear headings for each step. End with a "Diagnostic Summary" that states what real disagreement (if any) remains after the semantic unpacking.`;
  },
});
