import { runProposeRefactor } from './_shared';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

async function runProposeNoteMove(
  ctx: ToolContext, input: unknown, callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  const { path: notePath, destFolder } = input as { path?: string; destFolder?: string };
  if (typeof notePath !== 'string' || !notePath.trim()) return { content: 'path is required.', isError: true };
  if (typeof destFolder !== 'string') return { content: 'destFolder is required (use "" to move to the root).', isError: true };
  const from = notePath.trim();
  const base = from.split('/').pop()!;
  const folder = destFolder.trim().replace(/^\/+|\/+$/g, '');
  const to = folder ? `${folder}/${base}` : base;
  return runProposeRefactor(ctx, from, to, callbacks, 'Move');
}

export const proposeNoteMove: NotebaseTool = {
  definition: {
    name: 'propose_note_move',
    description:
      'Propose moving a note to a different folder (keep its filename). The user ' +
      'reviews a card showing the destination and every note whose links would ' +
      'be rewritten, then approves or discards. Inbound wiki-links and relative ' +
      'paths are updated automatically on approval. Use list_notes first to see ' +
      'the folder structure.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The note\'s current thoughtbase-relative path.' },
        destFolder: { type: 'string', description: 'Destination folder, relative to the root (e.g. "notes/algorithms"). Empty string = move to the root.' },
      },
      required: ['path', 'destFolder'],
    },
  },
  run: (ctx, input, callbacks) => runProposeNoteMove(ctx, input, callbacks),
};
