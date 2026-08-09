import { randomUUID } from 'node:crypto';
import { planFolderRename, RefactorError } from '../../notebase/rename';
import { planFolderReorg } from '../../notebase/reorg';
import type {
  ConversationRefactorDraft,
  ConversationReorgDraft,
} from '../../../shared/conversation-refactor-drafts';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

/**
 * propose_folder_move — the folder counterpart to propose_note_move/rename.
 * Dry-runs the folder move via `planFolderRename` (validates guardrails +
 * computes the blast radius: every note that relocates + every note whose
 * inbound links get rewritten), then forwards a refactor draft flagged
 * `isFolder` for review. Never moves anything — on Approve the renderer files a
 * `folder-refactor` proposal.
 */
/** One folder move, normalized to bare relative paths. */
interface FolderPair { from: string; to: string }

function parsePairs(input: unknown): { pairs: FolderPair[] } | { error: string } {
  const { moves } = input as { moves?: unknown };
  if (!Array.isArray(moves) || moves.length === 0) {
    return { error: 'moves is required: a non-empty array of { path, newPath } objects.' };
  }
  const pairs: FolderPair[] = [];
  for (const m of moves) {
    const { path: folderPath, newPath } = (m ?? {}) as { path?: unknown; newPath?: unknown };
    if (typeof folderPath !== 'string' || !folderPath.trim()) {
      return { error: 'each move needs a non-empty string `path`.' };
    }
    if (typeof newPath !== 'string' || !newPath.trim()) {
      return { error: 'each move needs a non-empty string `newPath` (the folder\'s full destination path).' };
    }
    pairs.push({
      from: folderPath.trim().replace(/^\/+|\/+$/g, ''),
      to: newPath.trim().replace(/^\/+|\/+$/g, ''),
    });
  }
  return { pairs };
}

/**
 * propose_folder_move — the folder counterpart to propose_note_move/rename.
 * Dry-runs each folder move via `planFolderRename` (validates guardrails +
 * computes the blast radius: every note that relocates + every note whose
 * inbound links get rewritten), then forwards a draft for review. Never moves
 * anything — on Approve the renderer files `folder-refactor` proposals.
 *
 * One folder keeps the single refactor card (its blast-radius view reads better
 * for one move). A batch routes through the reorg draft, exactly as batched
 * note moves do, so many folders are one card and one all-or-nothing bundle.
 */
async function runProposeFolderMove(
  ctx: ToolContext, input: unknown, callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  if (!ctx.conversationId) {
    return { content: 'propose_folder_move requires a bound conversation id.', isError: true };
  }
  const parsed = parsePairs(input);
  if ('error' in parsed) return { content: parsed.error, isError: true };
  const { pairs } = parsed;

  if (pairs.length > 1) {
    if (!callbacks.onReorgDraft) {
      return { content: 'propose_folder_move is only available in conversation contexts.', isError: true };
    }
    const plan = await planFolderReorg(ctx.rootPath, pairs.map((p) => ({ path: p.from, newPath: p.to })));
    if (plan.items.length === 0) {
      return { content: `No folder moves could be planned. ${plan.warnings.join(' ')}`.trim(), isError: true };
    }
    const draft: ConversationReorgDraft = {
      draftId: `reorg-${randomUUID()}`,
      conversationId: ctx.conversationId,
      note: `Move ${plan.items.length} folders`,
      items: plan.items.map((i) => ({ fromPath: i.fromPath, toPath: i.toPath, affectedNotes: i.affectedNotes })),
      warnings: plan.warnings,
      isFolder: true,
      createdAt: new Date().toISOString(),
    };
    callbacks.onReorgDraft(draft);

    const notesMoved = new Set(plan.items.flatMap((i) => i.affectedNotes.filter((a) => a.isMoved).map((a) => a.path)));
    const linkRewrites = new Set(plan.items.flatMap((i) => i.affectedNotes.filter((a) => !a.isMoved).map((a) => a.path)));
    return {
      content: JSON.stringify({
        status: 'drafted',
        draftId: draft.draftId,
        foldersMoved: plan.items.length,
        notesMoved: notesMoved.size,
        notesWithLinkRewrites: linkRewrites.size,
        ...(plan.warnings.length > 0 ? { warnings: plan.warnings } : {}),
        hint: 'STOP. The folder moves are queued for the user to review (per-item) and approve — nothing has moved. ' +
          'End the turn with one short acknowledgement and do NOT call this tool again this turn.',
      }),
      isError: false,
    };
  }

  if (!callbacks.onRefactorDraft) {
    return { content: 'propose_folder_move is only available in conversation contexts.', isError: true };
  }
  const { from, to } = pairs[0]!;

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
      'Propose moving OR renaming whole folders (and everything under them) for the ' +
      'user to review. Use this instead of moving notes one-by-one when a folder ' +
      'belongs somewhere else or should be renamed. Every note inside relocates and ' +
      'all inbound wiki-links + relative paths are rewritten automatically on ' +
      'approval; the user reviews a card showing the destinations and the affected ' +
      'notes. For each entry: to move, give a `newPath` under a different parent ' +
      '(keep the last segment); to rename, give a `newPath` with a different last ' +
      'segment. Use list_notes first to see the folder structure. ' +
      'Call this ONCE per turn with ALL the folders you want to move in `moves` — ' +
      'a batch becomes a single review card and a single all-or-nothing change, ' +
      'so do not call it once per folder. NOTHING moves until approved.',
    input_schema: {
      type: 'object',
      properties: {
        moves: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          description: 'One entry per folder to move or rename. Include every folder in this one call.',
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'The folder\'s current thoughtbase-relative path (e.g. "notes/old-topic").' },
              newPath: { type: 'string', description: 'The folder\'s full destination path (e.g. "notes/archive/old-topic" to move, or "notes/new-topic" to rename).' },
            },
            required: ['path', 'newPath'],
          },
        },
      },
      required: ['moves'],
    },
  },
  run: (ctx, input, callbacks) => runProposeFolderMove(ctx, input, callbacks),
};
