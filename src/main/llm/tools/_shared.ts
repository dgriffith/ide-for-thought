import { randomUUID } from 'node:crypto';
import { planRename, RefactorError } from '../../notebase/rename';
import type { ConversationRefactorDraft } from '../../../shared/conversation-refactor-drafts';
import type { ToolContext, ToolCallbacks } from './types';

/** Shared core: dry-run the rename (validates guardrails + computes the blast
 *  radius), then emit a refactor draft for review. Never moves the note. */
export async function runProposeRefactor(
  ctx: ToolContext, fromPath: string, toPath: string, callbacks: ToolCallbacks, verb: 'Rename' | 'Move',
): Promise<{ content: string; isError: boolean }> {
  if (!callbacks.onRefactorDraft) {
    return { content: `propose_note_${verb.toLowerCase()} is only available in conversation contexts.`, isError: true };
  }
  if (!ctx.conversationId) {
    return { content: `propose_note_${verb.toLowerCase()} requires a bound conversation id.`, isError: true };
  }
  let plan: Awaited<ReturnType<typeof planRename>>;
  try {
    plan = await planRename(ctx.rootPath, fromPath, toPath);
  } catch (e) {
    if (e instanceof RefactorError) return { content: `Cannot ${verb.toLowerCase()}: ${e.message}`, isError: true };
    throw e;
  }

  const draft: ConversationRefactorDraft = {
    draftId: `refactor-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: `${verb} ${fromPath} → ${toPath}`,
    fromPath,
    toPath,
    affectedNotes: plan.affectedNotes.map((a) => ({ path: a.path, before: a.before, after: a.after, isMoved: a.isMoved })),
    createdAt: new Date().toISOString(),
  };
  callbacks.onRefactorDraft(draft);

  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      fromPath,
      toPath,
      notesWithLinkRewrites: plan.affectedNotes.filter((a) => !a.isMoved).length,
      hint: 'STOP. The move/rename is queued for the user to review and approve — nothing has changed yet. ' +
        'End the turn with one short acknowledgement and do NOT call this tool again this turn.',
    }),
    isError: false,
  };
}
