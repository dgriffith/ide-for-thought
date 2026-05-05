import type {
  ConversationTemplate,
  TemplateContext,
} from '../../../shared/conversation-templates';

/**
 * Decompose: split a long note into a parent index + 2-7 focused children,
 * filed via `propose_notes` so the user reviews the bundle inline before
 * anything lands. Replaces the bespoke decompose pipeline (`decompose.ts`)
 * once parity is validated; in the meantime both paths coexist.
 */
const DECOMPOSE_TEMPLATE: ConversationTemplate = {
  id: 'decompose',
  label: 'Decompose into linked smaller notes',
  suggestedTitle: (ctx) => `Decompose: ${ctx.noteTitle ?? noteBasename(ctx) ?? 'note'}`,
  // Asking up front lets the agent shape the split without rambling first.
  // The bespoke pipeline didn't ask — but the bespoke pipeline also had
  // hard-coded heuristics; the template version benefits from a single
  // human-in-the-loop nudge when the right axis is genuinely ambiguous.
  requiresTools: ['ask_user'],
  buildPrompt: (ctx) => {
    const path = ctx.notePath ?? '(no active note — ask the user which note to decompose)';
    return `Decompose the note at \`${path}\` into a parent index note plus 2-7 focused child notes, filed as a single \`propose_notes\` bundle.

## Procedure

1. **Read the source.** Use \`read_note\` if you don't already have its content cached.
2. **Identify the split axis.** Most notes split cleanly along sections, topics, or argument structure. If the right axis is genuinely ambiguous, call \`ask_user\` with two or three concrete options drawn from the source — don't ask abstractly. If the axis is obvious from the content, just commit and proceed; do NOT call \`ask_user\` for confirmation.
3. **Pick 2-7 children.** Each child must cover one distinct topic or thread. Together they must losslessly cover everything substantive in the source. Merge related sections, split a section that's actually two topics, and invent titles that reflect what the child is really about — not just what the original heading said.
4. **Build the bundle.** Call \`propose_notes\` ONCE with:
   - **One parent note.** Body is a 1-3 paragraph orientation framing what the note is about and how the children relate. Do NOT inline the children's prose — point at them via \`[[basename]]\` wiki-links using the children's exact basenames.
   - **One child note per topic.** Title in 2-6 words, title-case. Body preserves the source's voice with minor tidying only — no heavy rewriting. No frontmatter required.
5. **Wiki-links.** Wiki-link resolution is exact-match on basename. Spell each \`[[Other Note Name]]\` IDENTICALLY to the OTHER payload's \`relativePath\` minus the trailing \`.md\`. Pick basenames you're willing to use as link targets unchanged — prefer simple names without commas/punctuation.
6. **End the turn.** After \`propose_notes\` returns, end with one short acknowledgement sentence ("Drafted N notes for review.") and stop. Do not repeat the contents inline.

## Constraints

- Each child must stand on its own. A reader landing on just that note should get a coherent chunk.
- The parent body must NOT contain a Contents list — the post-processor adds wiki-links automatically. (Do still link to the children inline in your orientation prose.)
- No fewer than 2 children. No more than 7.`;
  },
};

/**
 * Crystallize: extract structured thought components from a note's body
 * and file a "crystallization" note containing an embedded Turtle block.
 * The graph indexer auto-extracts the Turtle on save, so the components
 * land in the graph just like the bespoke crystallize pipeline produced —
 * but with a paper-trail note the user can navigate, edit, and link from.
 */
const CRYSTALLIZE_TEMPLATE: ConversationTemplate = {
  id: 'crystallize',
  label: 'Crystallize as components',
  suggestedTitle: (ctx) => `Crystallize: ${ctx.noteTitle ?? noteBasename(ctx) ?? 'note'}`,
  buildPrompt: (ctx) => {
    const path = ctx.notePath ?? '(no active note — ask the user which note to crystallize)';
    return `Extract the structured thought components from the note at \`${path}\` and file a single crystallization note containing an embedded Turtle block, via \`propose_notes\`.

## Procedure

1. **Read the source.** Use \`read_note\`.
2. **Refresh the schema if needed.** Call \`describe_graph_schema\` to remind yourself of the \`thought:\` ontology — Claim, Grounds, Warrant, Hypothesis, Question, Observation, Insight, Principle, Assumption, Implication, Definition, Goal, Plan, Tension. Use only types from that ontology.
3. **Identify the substantive components.** A component is a discrete epistemic unit, not every sentence. Aim for the load-bearing ideas. Skip throat-clearing. Capture inter-component relationships (\`thought:supports\`, \`thought:challenges\`, \`thought:presupposes\`, etc.) where they're clear.
4. **Build the crystallization note.** Call \`propose_notes\` with ONE note:
   - Path: \`crystallizations/<source-basename>.md\` (or another sensible location if the user has a preferred convention — don't ask, just match obvious patterns from existing notes if you can see them).
   - Title: a short summary of the source's core thesis.
   - Body: a 1-2 paragraph prose introduction, then a fenced \`\`\`turtle code block listing every component.
5. **Turtle requirements.** For each component include:
   - \`rdf:type\` (the thought-component class)
   - \`thought:label\` — concise summary, 1-2 sentences
   - \`thought:sourceText\` — the verbatim passage you extracted from
   - \`thought:extractedBy "llm:crystallization"\`
   - \`thought:hasStatus thought:proposed\`
   - Any inter-component relationships
   Use blank nodes (\`_:claim1\`, \`_:grounds1\`) or minted IRIs.
6. **End the turn.** After \`propose_notes\` returns, end with a single short acknowledgement and stop.

## Constraints

- Output ONE note in the bundle, not one note per component.
- The Turtle block must be valid (the indexer parses it on save).
- Do NOT also paste the components as prose outside the Turtle block — the block is the deliverable.`;
  },
};

const TEMPLATES: ConversationTemplate[] = [DECOMPOSE_TEMPLATE, CRYSTALLIZE_TEMPLATE];

const BY_ID = new Map<string, ConversationTemplate>(TEMPLATES.map((t) => [t.id, t]));

export function listTemplates(): ConversationTemplate[] {
  return TEMPLATES.slice();
}

export function getTemplate(id: string): ConversationTemplate | undefined {
  return BY_ID.get(id);
}

function noteBasename(ctx: TemplateContext): string | undefined {
  if (!ctx.notePath) return undefined;
  const last = ctx.notePath.split('/').pop();
  if (!last) return undefined;
  return last.replace(/\.md$/i, '');
}
