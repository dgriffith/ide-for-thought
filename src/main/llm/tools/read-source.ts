import * as fs from '../../notebase/fs';
import { projectContext } from '../../project-context-types';
import { sourceTitle } from '../../graph/index';
import type { NotebaseTool, ToolContext } from './types';
import { bareSourceId } from './agent-path';

/**
 * Read an ingested source's extracted body (#1371). Sibling of `read_note`:
 * read-only, main-process, no approval gate and no renderer callback. Where
 * `read_note` reads a thoughtbase-relative note path, this reads a source's
 * on-disk body by its source id — `.minerva/sources/<id>/body.md`, the same
 * file `window-manager.ts` re-reads on a meta change and that `indexSource`
 * embedded, which is why `search_related` surfaces `[source]` hits at all.
 */
async function runRead(ctx: ToolContext, input: unknown): Promise<string> {
  const { source_id } = input as { source_id?: unknown };
  if (typeof source_id !== 'string' || !source_id.trim()) {
    throw new Error('source_id is required');
  }
  // A source id is a flat identifier, never a path: this tool builds the
  // `.minerva/sources/<id>/body.md` path itself, so a separator or `..` would
  // walk it out of `sources/` (to `conversations/`, say). The fs read below is
  // also containment-guarded; this keeps it inside the directory meant.
  const id = bareSourceId(source_id.trim());

  let body: string;
  try {
    body = await fs.readFile(ctx.rootPath, `.minerva/sources/${id}/body.md`);
  } catch {
    throw new Error(
      `No readable body for source "${id}". Either the id is unknown or its text ` +
      `was never extracted (a source can have metadata but no body.md). Use ` +
      `search_related or query_graph to find valid source ids.`,
    );
  }

  // Short provenance header so the title travels with the body inline; richer
  // metadata (authors, URL, date) stays in the graph via query_graph. Falls
  // back to just the id when the source has no dc:title (or isn't indexed yet).
  const title = sourceTitle(projectContext(ctx.rootPath), id);
  const header = title && title !== id ? `[source ${id}] ${title}` : `[source ${id}]`;
  return `${header}\n\n${body}`;
}

export const readSource: NotebaseTool = {
  definition: {
    name: 'read_source',
    description:
      'Read the full extracted text of an ingested source (article, PDF, web ' +
      'page) by its source id — the identifier search_related surfaces on a ' +
      '`[source]` hit and that graph queries return. Returns the source body as ' +
      'markdown with a short provenance header (its title). Use this to ground ' +
      'an answer in the full text of the user\'s research library rather than ' +
      'the 240-char snippet search_related shows. For a plain note use ' +
      'read_note; for a source\'s structured metadata (authors, URL, date) use ' +
      'query_graph.',
    input_schema: {
      type: 'object',
      properties: {
        source_id: {
          type: 'string',
          description:
            'The bare source identifier (a `[source]` hit\'s ref from ' +
            'search_related, or a sourceId from a graph query). Not a path — ' +
            'separators and traversal (..) are rejected.',
        },
      },
      required: ['source_id'],
    },
  },
  run: async (ctx, input) => ({ content: await runRead(ctx, input), isError: false }),
};
