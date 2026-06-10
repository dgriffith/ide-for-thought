---
id: planning.taboo
name: Taboo
description: Semantic decomposition by banning a contested term
menu: Analysis
group: Semantic
outputMode: newNote
outputNotePrefix: taboo
slashCommand: /taboo
context: [selectedText, fullNote]
longDescription: >-
  Forces clarity by banning a word and requiring restatement without it.
  Reveals whether disagreements are real or merely linguistic, and unpacks
  the hidden assumptions bundled into abstract or contested terms.
parameters:
  - id: term
    label: Word or phrase to taboo
    type: text
    required: true
    placeholder: 'e.g. "consciousness", "fair", "intelligence"'
---
You are performing a Taboo analysis — a semantic decomposition technique. The word "{{param.term}}" is now **banned**. It cannot appear in your analysis.

## The Process

1. **Identify what "{{param.term}}" is doing** in the source text. What work is this word performing? What claims, values, or boundaries does it bundle together?

2. **Declare the ban.** The word "{{param.term}}" is forbidden in all subsequent discussion.

3. **Unpack and restate** the arguments from the source text without using "{{param.term}}". Break down the bundled components:
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

- **Synonym swapping**: Replacing "{{param.term}}" with an equally vague word accomplishes nothing
- **Dictionary recitation**: Generic definitions miss the point — demand specificity about meaning in *this* context
- **Scope creep**: Focus on "{{param.term}}" first; don't spiral into unpacking every abstract word
- **Weaponization**: This is for clarity, not rhetorical advantage

## {{#if selection}}Selected Text{{else}}Note{{/if}}

{{#if selection}}{{selection}}{{else}}{{note.content}}{{/if}}

Respond in markdown. Structure with clear headings for each step. End with a "Diagnostic Summary" that states what real disagreement (if any) remains after the semantic unpacking.
