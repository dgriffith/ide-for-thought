import { runProposeRefactorBatch, type RefactorPair } from './_shared';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

/** Same folder, new filename. `newName` is a filename, never a path, and gains
 *  a `.md` suffix if the model omitted one. */
function targetPath(fromPath: string, newName: string): string {
  const dir = fromPath.includes('/') ? fromPath.slice(0, fromPath.lastIndexOf('/')) : '';
  let base = newName.trim().split('/').pop()!;
  if (!base.endsWith('.md')) base += '.md';
  return dir ? `${dir}/${base}` : base;
}

async function runProposeNoteRename(
  ctx: ToolContext, input: unknown, callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  const { renames } = input as { renames?: unknown };
  if (!Array.isArray(renames) || renames.length === 0) {
    return { content: 'renames is required: a non-empty array of { path, newName } objects.', isError: true };
  }

  const pairs: RefactorPair[] = [];
  for (const r of renames) {
    const { path: notePath, newName } = (r ?? {}) as { path?: unknown; newName?: unknown };
    if (typeof notePath !== 'string' || !notePath.trim()) {
      return { content: 'each rename needs a non-empty string `path`.', isError: true };
    }
    if (typeof newName !== 'string' || !newName.trim()) {
      return { content: 'each rename needs a non-empty string `newName`.', isError: true };
    }
    const from = notePath.trim();
    pairs.push({ fromPath: from, toPath: targetPath(from, newName) });
  }

  return runProposeRefactorBatch(ctx, pairs, callbacks, 'Rename');
}

export const proposeNoteRename: NotebaseTool = {
  definition: {
    name: 'propose_note_rename',
    description:
      'Propose renaming one or more notes (keeping each note\'s folder, changing ' +
      'the filename). The user reviews a card showing the new names and every ' +
      'other note whose links would be rewritten, then approves or discards — ' +
      'nothing moves until then. Inbound wiki-links are updated automatically on ' +
      'approval. ' +
      'Call this ONCE per turn with ALL the notes you want to rename in ' +
      '`renames` — a batch becomes a single review card and a single ' +
      'all-or-nothing change, so do not call it once per note. To move notes ' +
      'between folders as well, use propose_note_move or propose_reorganization.',
    input_schema: {
      type: 'object',
      properties: {
        renames: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          description: 'One entry per note to rename. Include every note in this one call.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'The note\'s current thoughtbase-relative path.' },
              newName: { type: 'string', description: 'The new filename (not a path). ".md" is added if omitted.' },
            },
            required: ['path', 'newName'],
          },
        },
      },
      required: ['renames'],
    },
  },
  run: (ctx, input, callbacks) => runProposeNoteRename(ctx, input, callbacks),
};
