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
import SYSTEM_PROMPT from './load-bearing-claim.prompt.md?raw';

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
