import { searchHelpDocs, WEAK_MATCH_THRESHOLD } from '../../help-docs/search';
import type { HelpHit } from '../../help-docs/search';
import type { NotebaseTool } from './types';

async function runSearchHelp(input: unknown): Promise<string> {
  const { query, limit } = input as { query?: string; limit?: number };
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('query is required');
  }
  const n = Math.min(Math.max(Math.floor(limit ?? 5), 1), 20);
  const { hits, weakMatch } = await searchHelpDocs(query.trim(), n);

  if (hits.length === 0) {
    return `No help docs are available (the corpus has not been built for this checkout).`;
  }

  const body = hits.map((h: HelpHit, i: number) => {
    const snippet = h.text.replace(/\s+/g, ' ').trim().slice(0, 400);
    return `${i + 1}. ${h.pageTitle} > ${h.heading} (${h.sourcePage}, similarity ${h.score.toFixed(2)})\n   ${snippet}`;
  }).join('\n');

  if (!weakMatch) return body;
  return (
    `WEAK MATCH — the closest result still scored below the confidence threshold ` +
    `(${WEAK_MATCH_THRESHOLD}). The docs may not actually describe this; say so plainly ` +
    `rather than presenting the result below as a confident answer.\n${body}`
  );
}

export const searchHelp: NotebaseTool = {
  definition: {
    name: 'search_help',
    description:
      'Semantic search over Minerva\'s own user-facing documentation ' +
      '(website/docs) — the actual product, not general knowledge about ' +
      'markdown apps. Call this before answering any "how do I…" or "what ' +
      'does X do in Minerva" question, since training data has never seen ' +
      'this specific app and can be confidently wrong. Each result names the ' +
      'source page, section, and a similarity score; a WEAK MATCH prefix means ' +
      'the docs likely don\'t cover this — say so instead of falling back to ' +
      'general knowledge. Use search_notes/search_related for the user\'s own ' +
      'notes, not this tool.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Free-text description of what to find, matched by meaning.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return. Defaults to 5.',
          minimum: 1,
          maximum: 20,
        },
      },
      required: ['query'],
    },
  },
  run: async (_ctx, input) => ({ content: await runSearchHelp(input), isError: false }),
};
