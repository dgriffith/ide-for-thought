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
import SHARED_BODY from './find-arguments-shared.prompt.md?raw';

export type Polarity = 'support' | 'oppose';

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
