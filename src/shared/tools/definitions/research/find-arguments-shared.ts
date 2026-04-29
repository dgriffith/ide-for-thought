/**
 * Shared system-prompt + first-message builders for the Find
 * Supporting / Find Opposing Arguments tools (#409 / #410).
 *
 * Both tools have identical mechanics — a claim under the cursor, a
 * conversation that builds the strongest case, a single proposed note
 * with the polarity-specific frontmatter. The only differences are
 * the polarity-specific verbiage (favour vs against, supports: vs
 * rebuts:) and the anti-flattery rule. Sharing the builders keeps the
 * note shape contract in one place — drift between the two tools
 * would manifest as inconsistent indexable structure.
 */

import type { ToolContext } from '../../types';

export type Polarity = 'support' | 'oppose';

const SHARED_BODY = `You are helping a researcher audit a specific claim. The user picked the claim before invoking you, and the claim's URI, label, and source-text are below — that's what to argue about.

## Process

1. Read the claim text. Use the web tools (web_search, web_fetch) to ground your case in real sources — at least one citation per argument is the bar; an uncited argument doesn't make the cut.
2. Surface the strongest cases first, weakest last. Grade each: \`strong\`, \`moderate\`, or \`weak\`. Strength is about the argument as an argument, not about whether you find the original claim plausible overall.
3. Iterate with the user. They may want to push on a specific argument, ask for a different angle, or have you regroup with extra context. Treat the first response as a starting point, not a final answer.

## Filing the result

When the user is satisfied, call \`propose_notes\` with **one** note. The note's frontmatter encodes the structural fact (this analysis supports/rebuts the claim) so the graph picks it up via indexing — no separate triples payload needed. Use this shape exactly:

\`\`\`markdown
---
title: <Supporting | Opposing> arguments — <short paraphrase of the claim>
{{POLARITY_FRONTMATTER}}
---

# <Supporting | Opposing> arguments — <short paraphrase of the claim>

> <verbatim claim source-text quote>

## Summary

<2-4 sentences of prose summarising the case overall>

## Argument 1: <short label>

_strength:_ \`strong\`

<the inferential chain — "X because Y because Z, so the original claim {{POLARITY_VERB}}">

**Citations:**

- [<URL>](<URL>) — "<verbatim snippet>"

## Argument 2: …
\`\`\`

The frontmatter URI is the load-bearing piece — that's what materialises the \`thought:{{POLARITY_PREDICATE}}\` triple. **Use the literal claim URI as the value** (not a wiki-link, not a paraphrase): the indexer recognises bare \`https://…\` values as IRI nodes.

## Anti-flattery

{{POLARITY_ANTIFLATTERY}}

If you genuinely cannot find at least one argument that meets the bar (cited, coherent, at least \`weak\`), do **not** call \`propose_notes\`. Tell the user clearly that the strong case isn't there and stop — that's a real answer. Padding the list with weak rebuttals to look responsive is worse than the empty result.`;

export function buildFindArgumentsSystemPrompt(polarity: Polarity, ctx: ToolContext): string {
  const claimUri = ctx.claimUri ?? '';
  if (!claimUri) {
    // The renderer should have surfaced a "no claim under cursor" error
    // before we got here (see App.svelte's pre-invoke check), but if
    // the tool somehow runs with no URI, give the model a clear error
    // it can echo back rather than fabricating arguments for an
    // imagined claim.
    throw new Error(
      'Find Supporting / Opposing Arguments needs a thought:Claim URI under the cursor. Right-click on a line that contains a claim URI before invoking the tool.',
    );
  }
  const polarityFrontmatter = polarity === 'support'
    ? `supports: ${claimUri}`
    : `rebuts: ${claimUri}`;
  const polarityPredicate = polarity === 'support' ? 'supports' : 'rebuts';
  const polarityVerb = polarity === 'support' ? 'follows' : 'fails';
  const polarityAntiflattery = polarity === 'support'
    ? 'Do **not** soften the case if you personally disagree with the claim. Do **not** inflate the case beyond what the citations actually support.'
    : 'Do **not** weaken the opposition because the user clearly prefers the original claim or earlier conversation suggests they want it defended. The user is asking you to argue the other side — your job is to do that as forcefully as the evidence allows.';

  const body = SHARED_BODY
    .replace(/{{POLARITY_FRONTMATTER}}/g, polarityFrontmatter)
    .replace(/{{POLARITY_PREDICATE}}/g, polarityPredicate)
    .replace(/{{POLARITY_VERB}}/g, polarityVerb)
    .replace(/{{POLARITY_ANTIFLATTERY}}/g, polarityAntiflattery);

  const claimBlock = [
    '## Claim',
    '',
    `**URI:** \`${claimUri}\``,
    '',
    ctx.claimLabel ? `**Label:** ${ctx.claimLabel}` : '',
    '',
    ctx.claimSourceText
      ? '**Source passage:**\n\n' + ctx.claimSourceText.split(/\r?\n/).map((l) => `> ${l}`).join('\n')
      : '',
  ].filter(Boolean).join('\n');

  return `${body}\n\n${claimBlock}`;
}

export function buildFindArgumentsFirstMessage(polarity: Polarity, ctx: ToolContext): string {
  const verb = polarity === 'support' ? 'support' : 'rebut';
  const headline = ctx.claimLabel
    ? `Find the strongest arguments that ${verb} this claim:\n\n**${ctx.claimLabel}**`
    : `Find the strongest arguments that ${verb} the claim under discussion.`;
  const sourceBlock = ctx.claimSourceText
    ? '\n\n' + ctx.claimSourceText.split(/\r?\n/).map((l) => `> ${l}`).join('\n')
    : '';
  return `${headline}${sourceBlock}\n\nUse web search freely. When you're satisfied with the case, ask me to file — I'll review the proposed note before anything lands.`;
}
