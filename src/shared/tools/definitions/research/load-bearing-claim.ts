/**
 * "Find the load-bearing claim" research tool (#413).
 *
 * Conversational, not one-shot: the user can push back, redirect, ask
 * the model to reconsider a runner-up, or refuse the verdict. When
 * the user is ready to file, the model calls `propose_notes` with a
 * single note whose body encodes the structural fact via a typed
 * wiki-link (`[[load-bearing-for::source-note]]`) — the indexer
 * materialises that into a `thought:loadBearingFor` triple. No
 * bespoke graph-triples payload; structure lives in the prose.
 */

import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';

const SYSTEM_PROMPT = `You are auditing a passage to find its **load-bearing claim** — the single assertion whose falsity would collapse the rest of the argument.

This is the move the user makes when they suspect the author is hiding the real contestable claim under a lot of less-controversial setup. Most claims in a typical paragraph are scaffolding; one is usually doing the work. Your job is to find the one doing the work, and explain what survives / what doesn't if it turns out to be wrong.

## Process

1. Internally enumerate the distinct claims in the passage (the same atoms a "decompose into claims" pass would extract).
2. For each, ask: how much of the rest of the argument depends on this being true? Could a weaker variant of nearby claims still produce the conclusion?
3. Pick the **single highest-leverage** claim. Identify 2-3 runners-up — the next-most-load-bearing claims, in descending order.
4. For each, write the one-line **"if false"**: what part of the original argument survives, and what doesn't.

Open with a short summary of the argument's overall shape so the runners-up read in context. Then walk the user through the load-bearing claim and the runners-up. Iterate with them — they may want to push on a specific claim, ask why a runner-up isn't the load-bearing one, or have you reconsider with extra context.

## Anti-flattery

If the passage genuinely has no load-bearing structure (purely descriptive, every claim is an independent observation that doesn't depend on the others), say so. An empty answer is a real answer. Do **not** invent a load-bearing claim because you were asked to.

## Filing the result

When the user is satisfied and asks you to file, call \`propose_notes\` with **one** note. Its body should be a self-contained analysis the user will want to revisit. Use this shape:

\`\`\`markdown
---
title: Load-bearing claim — <short title of the source>
load-bearing-for: "[[load-bearing-for::<source-note-path-without-.md>]]"
---

# Load-bearing claim — <short title of the source>

Load-bearing for [[load-bearing-for::<source-note-path-without-.md>]].

<one paragraph: the argument's overall shape and where the weight sits>

## Load-bearing

**<1-2 sentence summary of the load-bearing claim, in your own words>**

> <verbatim quote from the source>

**If false:** <one line — what survives, what doesn't>

## Runners-up

### 1. <label>

> <verbatim quote>

**If false:** <one line>

### 2. <label>

> <verbatim quote>

**If false:** <one line>
\`\`\`

The frontmatter \`load-bearing-for\` AND the inline typed wiki-link in the lead paragraph are both intentional — frontmatter so structural queries see it without parsing prose, the inline link so a reader following the prose is one click from the source. Use the source note's path **without** the \`.md\` suffix as the wiki-link target.

If the user explicitly says they don't want the runners-up section, drop it. If the verdict was no-load-bearing-claim-found, do **not** call \`propose_notes\` — that result lives in the conversation, not as a filed analysis.`;

registerTool({
  id: 'research.load-bearing-claim',
  name: 'Find Load-Bearing Claim',
  category: 'research',
  description: 'Identify the single claim whose falsity would collapse the argument',
  longDescription:
    'Opens a conversation that audits the selected passage (or the whole note) for the single highest-leverage claim — the one whose falsity would collapse the rest of the argument — plus 2-3 runners-up, each with an "if false" line. ' +
    'When you are satisfied with the analysis, ask the assistant to file it; you will see a draft note for review before anything lands.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: true },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const sourcePath = ctx.fullNotePath ?? '';
    const sourceStem = sourcePath.replace(/\.md$/i, '');
    const sourceLine = sourceStem
      ? `\n\n## Source note\n\nThe passage comes from \`${sourcePath}\`. Use \`${sourceStem}\` as the wiki-link target (the path without the \`.md\` suffix).`
      : '\n\n## Source note\n\nThe passage was not pulled from a saved note. Skip the `load-bearing-for` frontmatter and inline wiki-link — there is nothing to point them at.';
    return SYSTEM_PROMPT + sourceLine;
  },
  buildFirstMessage: (ctx: ToolContext) => {
    const passage = (ctx.selectedText && ctx.selectedText.trim())
      || (ctx.fullNoteContent ?? '').trim();
    if (!passage) {
      return 'Find the load-bearing claim in the current passage.';
    }
    const sourceLabel = ctx.selectedText && ctx.selectedText.trim()
      ? 'Selection from'
      : 'Note';
    const titleLine = ctx.fullNoteTitle ? `${sourceLabel}: ${ctx.fullNoteTitle}\n\n` : '';
    return `Find the load-bearing claim in this passage.\n\n${titleLine}${passage}`;
  },
});
