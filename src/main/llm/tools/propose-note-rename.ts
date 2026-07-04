import { runProposeRefactor } from './_shared';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

async function runProposeNoteRename(
  ctx: ToolContext, input: unknown, callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  const { path: notePath, newName } = input as { path?: string; newName?: string };
  if (typeof notePath !== 'string' || !notePath.trim()) return { content: 'path is required.', isError: true };
  if (typeof newName !== 'string' || !newName.trim()) return { content: 'newName is required.', isError: true };
  const from = notePath.trim();
  const dir = from.includes('/') ? from.slice(0, from.lastIndexOf('/')) : '';
  let base = newName.trim().split('/').pop()!; // a filename, never a path
  if (!base.endsWith('.md')) base += '.md';
  const to = dir ? `${dir}/${base}` : base;
  return runProposeRefactor(ctx, from, to, callbacks, 'Rename');
}

export const proposeNoteRename: NotebaseTool = {
  definition: {
    name: 'propose_note_rename',
    description:
      'Propose renaming a note (keep its folder, change the filename). The user ' +
      'reviews a card showing the new name and every other note whose links ' +
      'would be rewritten, then approves or discards — nothing moves until then. ' +
      'Inbound wiki-links are updated automatically on approval.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The note\'s current thoughtbase-relative path (e.g. "notes/raft.md").' },
        newName: { type: 'string', description: 'The new filename, with or without ".md" (e.g. "raft-consensus").' },
      },
      required: ['path', 'newName'],
    },
  },
  run: (ctx, input, callbacks) => runProposeNoteRename(ctx, input, callbacks),
};
