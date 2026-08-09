import { randomUUID } from 'node:crypto';
import { planRename, RefactorError } from '../../notebase/rename';
import { planReorg } from '../../notebase/reorg';
import type {
  ConversationRefactorDraft,
  ConversationReorgDraft,
} from '../../../shared/conversation-refactor-drafts';
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

/** One requested move/rename, already resolved to a full destination path. */
export interface RefactorPair {
  fromPath: string;
  toPath: string;
}

/**
 * Batch entry point for `propose_note_move` / `propose_note_rename` (#1777).
 *
 * A request that moves twenty notes used to be twenty tool calls, twenty review
 * cards, and twenty proposals. Rather than grow a second batch shape, a batch
 * routes through the machinery `propose_reorganization` already uses end to
 * end: `planReorg` dry-runs each operation in order (so item N sees the moves
 * from items 1..N-1), drops unplannable ones with a warning instead of failing
 * the lot, and the resulting reorg draft gets per-item checkboxes and files ONE
 * ordered `note-refactor` bundle.
 *
 * A single move/rename keeps the existing refactor card — that's the common
 * case, and its blast-radius view is better for one note than a plan card is.
 * The two tools differ from `propose_reorganization` only in ergonomics: it
 * takes a full `newPath` per item, these take a `destFolder` / `newName`.
 */
export async function runProposeRefactorBatch(
  ctx: ToolContext,
  pairs: RefactorPair[],
  callbacks: ToolCallbacks,
  verb: 'Rename' | 'Move',
): Promise<{ content: string; isError: boolean }> {
  const lower = verb.toLowerCase();
  if (pairs.length === 1) {
    return runProposeRefactor(ctx, pairs[0]!.fromPath, pairs[0]!.toPath, callbacks, verb);
  }
  if (!callbacks.onReorgDraft) {
    return { content: `propose_note_${lower} is only available in conversation contexts.`, isError: true };
  }
  if (!ctx.conversationId) {
    return { content: `propose_note_${lower} requires a bound conversation id.`, isError: true };
  }

  const plan = await planReorg(
    ctx.rootPath,
    pairs.map((p) => ({ path: p.fromPath, newPath: p.toPath })),
  );
  if (plan.items.length === 0) {
    return { content: `No ${lower}s could be planned. ${plan.warnings.join(' ')}`.trim(), isError: true };
  }

  const draft: ConversationReorgDraft = {
    draftId: `reorg-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: `${verb} ${plan.items.length} notes`,
    items: plan.items.map((i) => ({ fromPath: i.fromPath, toPath: i.toPath, affectedNotes: i.affectedNotes })),
    warnings: plan.warnings,
    createdAt: new Date().toISOString(),
  };
  callbacks.onReorgDraft(draft);

  const linkRewrites = new Set(
    plan.items.flatMap((i) => i.affectedNotes.filter((a) => !a.isMoved).map((a) => a.path)),
  );
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      notesMoved: plan.items.length,
      notesWithLinkRewrites: linkRewrites.size,
      ...(plan.warnings.length > 0 ? { warnings: plan.warnings } : {}),
      hint: `STOP. The ${lower}s are queued for the user to review (per-item) and approve — nothing has moved. ` +
        'End the turn with one short acknowledgement and do NOT call this tool again this turn.',
    }),
    isError: false,
  };
}
