import { runProposeRefactorBatch, type RefactorPair } from './_shared';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

/** `dest/` + the note's existing filename. `destFolder` of "" means the root. */
function targetPath(fromPath: string, destFolder: string): string {
  const base = fromPath.split('/').pop()!;
  const folder = destFolder.trim().replace(/^\/+|\/+$/g, '');
  return folder ? `${folder}/${base}` : base;
}

async function runProposeNoteMove(
  ctx: ToolContext, input: unknown, callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  const { moves } = input as { moves?: unknown };
  if (!Array.isArray(moves) || moves.length === 0) {
    return { content: 'moves is required: a non-empty array of { path, destFolder } objects.', isError: true };
  }

  const pairs: RefactorPair[] = [];
  for (const m of moves) {
    const { path: notePath, destFolder } = (m ?? {}) as { path?: unknown; destFolder?: unknown };
    if (typeof notePath !== 'string' || !notePath.trim()) {
      return { content: 'each move needs a non-empty string `path`.', isError: true };
    }
    if (typeof destFolder !== 'string') {
      return { content: 'each move needs a `destFolder` string (use "" to move to the root).', isError: true };
    }
    const from = notePath.trim();
    pairs.push({ fromPath: from, toPath: targetPath(from, destFolder) });
  }

  return runProposeRefactorBatch(ctx, pairs, callbacks, 'Move');
}

export const proposeNoteMove: NotebaseTool = {
  definition: {
    name: 'propose_note_move',
    description:
      'Propose moving one or more notes to a different folder (keeping each ' +
      'filename). The user reviews a card showing the destinations and every note ' +
      'whose links would be rewritten, then approves or discards. Inbound ' +
      'wiki-links and relative paths are updated automatically on approval. ' +
      'Use list_notes first to see the folder structure. ' +
      'Call this ONCE per turn with ALL the notes you want to move in `moves` — ' +
      'a batch becomes a single review card and a single all-or-nothing change, ' +
      'so do not call it once per note. If you are also renaming notes, or the ' +
      'destinations differ per note in more than the folder, use ' +
      'propose_reorganization instead (it takes a full target path per note).',
    input_schema: {
      type: 'object',
      properties: {
        moves: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          description: 'One entry per note to move. Include every note in this one call.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'The note\'s current thoughtbase-relative path.' },
              destFolder: { type: 'string', description: 'Destination folder, relative to the root (e.g. "notes/algorithms"). Empty string = move to the root.' },
            },
            required: ['path', 'destFolder'],
          },
        },
      },
      required: ['moves'],
    },
  },
  run: (ctx, input, callbacks) => runProposeNoteMove(ctx, input, callbacks),
};
