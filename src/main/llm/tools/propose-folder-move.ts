import { randomUUID } from 'node:crypto';
import { planFolderRename, RefactorError } from '../../notebase/rename';
import type { ConversationRefactorDraft } from '../../../shared/conversation-refactor-drafts';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

/**
 * propose_folder_move — the folder counterpart to propose_note_move/rename.
 * Dry-runs the folder move via `planFolderRename` (validates guardrails +
 * computes the blast radius: every note that relocates + every note whose
 * inbound links get rewritten), then forwards a refactor draft flagged
 * `isFolder` for review. Never moves anything — on Approve the renderer files a
 * `folder-refactor` proposal.
 */
async function runProposeFolderMove(
  ctx: ToolContext, input: unknown, callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  if (!callbacks.onRefactorDraft) {
    return { content: 'propose_folder_move is only available in conversation contexts.', isError: true };
  }
  if (!ctx.conversationId) {
    return { content: 'propose_folder_move requires a bound conversation id.', isError: true };
  }
  const { path: folderPath, newPath } = input as { path?: string; newPath?: string };
  if (typeof folderPath !== 'string' || !folderPath.trim()) return { content: 'path is required.', isError: true };
  if (typeof newPath !== 'string' || !newPath.trim()) return { content: 'newPath is required (the folder\'s full destination path).', isError: true };
  const from = folderPath.trim().replace(/^\/+|\/+$/g, '');
  const to = newPath.trim().replace(/^\/+|\/+$/g, '');

  let plan: Awaited<ReturnType<typeof planFolderRename>>;
  try {
    plan = await planFolderRename(ctx.rootPath, from, to);
  } catch (e) {
    if (e instanceof RefactorError) return { content: `Cannot move folder: ${e.message}`, isError: true };
    throw e;
  }

  const notesMoved = plan.affectedNotes.filter((a) => a.isMoved).length;
  const notesWithLinkRewrites = plan.affectedNotes.filter((a) => !a.isMoved).length;

  const draft: ConversationRefactorDraft = {
    draftId: `refactor-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: `Move folder ${from} → ${to}`,
    fromPath: from,
    toPath: to,
    affectedNotes: plan.affectedNotes.map((a) => ({ path: a.path, before: a.before, after: a.after, isMoved: a.isMoved })),
    isFolder: true,
    createdAt: new Date().toISOString(),
  };
  callbacks.onRefactorDraft(draft);

  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      fromPath: from,
      toPath: to,
      notesMoved,
      notesWithLinkRewrites,
      hint: 'STOP. The folder move is queued for the user to review and approve — nothing has changed yet. ' +
        'End the turn with one short acknowledgement and do NOT call this tool again this turn.',
    }),
    isError: false,
  };
}

export const proposeFolderMove: NotebaseTool = {
  definition: {
    name: 'propose_folder_move',
    description:
      'Propose moving OR renaming a whole folder (and everything under it) for the ' +
      'user to review. Use this instead of moving notes one-by-one when a folder ' +
      'belongs somewhere else or should be renamed. Every note inside relocates and ' +
      'all inbound wiki-links + relative paths are rewritten automatically on ' +
      'approval; the user reviews a card showing the destination and the affected ' +
      'notes. To move, give a `newPath` under a different parent (keep the last ' +
      'segment); to rename, give a `newPath` with a different last segment. Use ' +
      'list_notes first to see the folder structure. NOTHING moves until approved.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The folder\'s current thoughtbase-relative path (e.g. "notes/old-topic").' },
        newPath: { type: 'string', description: 'The folder\'s full destination path (e.g. "notes/archive/old-topic" to move, or "notes/new-topic" to rename).' },
      },
      required: ['path', 'newPath'],
    },
  },
  run: (ctx, input, callbacks) => runProposeFolderMove(ctx, input, callbacks),
};
