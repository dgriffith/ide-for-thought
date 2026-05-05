/**
 * "Decompose into Claims" research tool (#408).
 *
 * Conversational. The user picks a passage (selection or whole note);
 * the model identifies the distinct claims, iterates with the user,
 * and eventually proposes a bundle via `propose_notes`: ONE parent
 * decomposition note + N child claim notes, one per claim.
 *
 * Structure flows entirely from the notes themselves:
 *   - Parent note's frontmatter: `decomposes: "[[<source-note>]]"`
 *     materialises a `thought:decomposes` edge. Body uses ordinary
 *     wiki-links to each child claim note.
 *   - Each child note's frontmatter encodes the claim:
 *       claim-kind: factual | evaluative | definitional | predictive
 *       source-text: <verbatim quote>
 *       extracted-from: "[[<source-note>]]"
 *       extracted-by: llm:decompose-claims
 *     plus a small `turtle` block declaring `this: a thought:Claim`
 *     so queries that filter on rdf:type still match.
 *
 * No bespoke graph-triples payload — the indexer derives every edge
 * from indexing the proposed notes.
 */

import { registerTool } from '../../registry';
import type { ToolContext } from '../../types';
import SYSTEM_PROMPT from './decompose-into-claims.prompt.md?raw';

registerTool({
  id: 'research.decompose-into-claims',
  name: 'Decompose into Claims',
  category: 'research',
  description: 'Pull every distinct assertion out as its own typed claim',
  longDescription:
    'Opens a conversation that decomposes the selected passage (or the whole note) into individual claims, one per atom. ' +
    'Each claim is typed (factual / evaluative / definitional / predictive). When you are satisfied, the assistant proposes a bundle: a parent decomposition note plus one note per claim, each tagged so the graph treats them as `thought:Claim` nodes.',
  context: ['selectedText', 'fullNote'],
  outputMode: 'openConversation',
  preferredModel: 'claude-sonnet-4-6',
  web: { defaultEnabled: false },
  buildPrompt: () => '',
  buildSystemPrompt: (ctx: ToolContext) => {
    const sourcePath = ctx.fullNotePath ?? '';
    const sourceStem = sourcePath.replace(/\.md$/i, '');
    const sourceTitle = ctx.fullNoteTitle ?? sourceStem;
    const sourceLine = sourceStem
      ? `\n\n## Source note\n\nThe passage comes from \`${sourcePath}\`. Use \`${sourceStem}\` as the wiki-link target everywhere the prompt says \`<source-note-stem>\`. Use \`${sourceTitle}\` (or a short slug derived from it) in titles and basenames where the prompt says \`<source-title>\` / \`<source-stem>\`.`
      : '\n\n## Source note\n\nThe passage was not pulled from a saved note. Skip the `decomposes:` and `extracted-from:` frontmatter keys — there is nothing to point them at — and use a generic stem like `passage` for derived filenames.';
    return SYSTEM_PROMPT + sourceLine;
  },
  buildFirstMessage: (ctx: ToolContext) => {
    const passage = (ctx.selectedText && ctx.selectedText.trim())
      || (ctx.fullNoteContent ?? '').trim();
    if (!passage) {
      return 'Decompose the current passage into individual claims.';
    }
    const label = ctx.selectedText && ctx.selectedText.trim()
      ? 'Selection from'
      : 'Note';
    const titleLine = ctx.fullNoteTitle ? `${label}: ${ctx.fullNoteTitle}\n\n` : '';
    return `Decompose this passage into individual claims. List each one with its kind so I can confirm or adjust before you file.\n\n${titleLine}${passage}`;
  },
});
