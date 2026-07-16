import * as search from '../../search/index';
import { projectContext } from '../../project-context-types';
import type { NotebaseTool, ToolContext } from './types';

async function runSearch(ctx: ToolContext, input: unknown): Promise<string> {
  const { query, limit } = input as { query: string; limit?: number };
  if (typeof query !== 'string' || !query.trim()) {
    throw new Error('query is required');
  }
  const results = await search.search(projectContext(ctx.rootPath), query, { limit: limit ?? 10 });
  if (results.length === 0) {
    return `No results for "${query}".`;
  }
  return results
    .map((r, i) => {
      const snippet = r.snippet.replace(/\s+/g, ' ').trim().slice(0, 240);
      return `${i + 1}. ${r.title} (${r.relativePath})\n   ${snippet}`;
    })
    .join('\n');
}

export const searchNotes: NotebaseTool = {
  definition: {
    name: 'search_notes',
    description:
      'Full-text search across all notes in the current thoughtbase. Returns ' +
      'matching notes ranked by relevance, with title, relative path, and a ' +
      'short snippet for each. Use this to find notes by keyword when you do ' +
      'not already know the exact path.',
    input_schema: {
      type: 'object',
      properties: {
        query: {
          type: 'string',
          description: 'Search terms. MiniSearch syntax is supported.',
        },
        limit: {
          type: 'integer',
          description: 'Maximum number of results to return. Defaults to 10.',
          minimum: 1,
          maximum: 50,
        },
      },
      required: ['query'],
    },
  },
  run: async (ctx, input) => ({ content: await runSearch(ctx, input), isError: false }),
};
