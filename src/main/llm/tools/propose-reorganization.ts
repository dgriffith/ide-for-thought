import { randomUUID } from 'node:crypto';
import { planReorg, type ReorgOperation } from '../../notebase/reorg';
import type { ConversationReorgDraft } from '../../../shared/conversation-refactor-drafts';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

async function runProposeReorganization(
  ctx: ToolContext, input: unknown, callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  if (!callbacks.onReorgDraft) return { content: 'propose_reorganization is only available in conversation contexts.', isError: true };
  if (!ctx.conversationId) return { content: 'propose_reorganization requires a bound conversation id.', isError: true };

  const { operations } = input as { operations?: unknown };
  if (!Array.isArray(operations) || operations.length === 0) {
    return { content: 'operations is required: a non-empty array of { path, newPath }.', isError: true };
  }
  const ops: ReorgOperation[] = [];
  for (const o of operations) {
    const op = o as { path?: unknown; newPath?: unknown };
    if (typeof op.path !== 'string' || !op.path.trim() || typeof op.newPath !== 'string' || !op.newPath.trim()) {
      return { content: 'each operation needs a non-empty string `path` and `newPath`.', isError: true };
    }
    ops.push({ path: op.path.trim(), newPath: op.newPath.trim() });
  }

  const plan = await planReorg(ctx.rootPath, ops);
  if (plan.items.length === 0) {
    return { content: `No operations could be planned. ${plan.warnings.join(' ')}`.trim(), isError: true };
  }

  const draft: ConversationReorgDraft = {
    draftId: `reorg-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: `Reorganize ${plan.items.length} note${plan.items.length === 1 ? '' : 's'}`,
    items: plan.items.map((i) => ({ fromPath: i.fromPath, toPath: i.toPath, affectedNotes: i.affectedNotes })),
    warnings: plan.warnings,
    createdAt: new Date().toISOString(),
  };
  callbacks.onReorgDraft(draft);

  const linkRewrites = new Set(plan.items.flatMap((i) => i.affectedNotes.filter((a) => !a.isMoved).map((a) => a.path)));
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      notesMoved: plan.items.length,
      notesWithLinkRewrites: linkRewrites.size,
      warnings: plan.warnings,
      hint: 'STOP. The reorganization plan is queued for the user to review (per-item) and approve — nothing has moved. ' +
        'End the turn with one short acknowledgement and do NOT call this tool again this turn.',
    }),
    isError: false,
  };
}

export const proposeReorganization: NotebaseTool = {
  definition: {
    name: 'propose_reorganization',
    description:
      'Propose a whole reorganization — many note moves/renames at once — for the ' +
      'user to review as a single plan with per-item checkboxes (they can approve ' +
      'a subset). Use this instead of many propose_note_move/rename calls when ' +
      'restructuring a thoughtbase. Call list_notes first to see the current ' +
      'layout. Each operation gives the note\'s current `path` and its full target ' +
      '`newPath`. Inbound links are rewritten automatically on approval; nothing ' +
      'moves until the user approves.',
    input_schema: {
      type: 'object',
      properties: {
        operations: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          description: 'The moves/renames that make up the plan.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'The note\'s current thoughtbase-relative path.' },
              newPath: { type: 'string', description: 'The full destination path (folder + filename, ending in .md).' },
            },
            required: ['path', 'newPath'],
          },
        },
      },
      required: ['operations'],
    },
  },
  run: (ctx, input, callbacks) => runProposeReorganization(ctx, input, callbacks),
};
