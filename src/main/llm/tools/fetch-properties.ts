import * as fs from '../../notebase/fs';
import { readFrontmatterProperties } from '../../../shared/refactor/frontmatter-patch';
import type { NotebaseTool, ToolContext } from './types';

/**
 * Read the frontmatter of a single note and return it as JSON. No
 * approval gate — this is read-only and symmetric with `read_note`.
 */
async function runFetchProperties(ctx: ToolContext, input: unknown): Promise<string> {
  const { relative_path } = input as { relative_path: string };
  if (typeof relative_path !== 'string' || !relative_path) {
    throw new Error('relative_path is required');
  }
  const content = await fs.readFile(ctx.rootPath, relative_path);
  const props = readFrontmatterProperties(content);
  return JSON.stringify(props, null, 2);
}

export const fetchProperties: NotebaseTool = {
  definition: {
    name: 'fetch_properties',
    description:
      'Read the YAML frontmatter properties of a note. Returns the ' +
      'frontmatter as a JSON object — keys like `title`, `tags`, `status`, ' +
      'custom user fields, etc. Returns `{}` when the note has no ' +
      'frontmatter or the YAML is malformed. Use this before ' +
      '`set_properties` when you need to read the existing value of a key ' +
      'you intend to update (e.g. to append to an array rather than ' +
      'replace it). Does not load the note body — call `read_note` for ' +
      'that.',
    input_schema: {
      type: 'object',
      properties: {
        relative_path: {
          type: 'string',
          description:
            'Path relative to the thoughtbase root, including the `.md` ' +
            'extension. Path traversal (..) is rejected.',
        },
      },
      required: ['relative_path'],
    },
  },
  run: async (ctx, input) => ({ content: await runFetchProperties(ctx, input), isError: false }),
};
