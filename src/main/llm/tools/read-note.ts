import * as fs from '../../notebase/fs';
import type { NotebaseTool, ToolContext } from './types';

async function runRead(ctx: ToolContext, input: unknown): Promise<string> {
  const { relative_path } = input as { relative_path: string };
  if (typeof relative_path !== 'string' || !relative_path) {
    throw new Error('relative_path is required');
  }
  return fs.readFile(ctx.rootPath, relative_path);
}

export const readNote: NotebaseTool = {
  definition: {
    name: 'read_note',
    description:
      'Read the full contents of a note by its thoughtbase-relative path ' +
      '(e.g. "notes/topics/llm-trust.md"). Returns the raw markdown including ' +
      'any frontmatter. Use this when you have a path from search_notes, from ' +
      'a wiki-link in another note, or from a graph query, and need the full ' +
      'text.',
    input_schema: {
      type: 'object',
      properties: {
        relative_path: {
          type: 'string',
          description:
            'Path relative to the thoughtbase root. Must include the file ' +
            'extension. Path traversal (..) is rejected.',
        },
      },
      required: ['relative_path'],
    },
  },
  run: async (ctx, input) => ({ content: await runRead(ctx, input), isError: false }),
};
