import { randomUUID } from 'node:crypto';
import nodeFs from 'node:fs/promises';
import nodePath from 'node:path';
import * as graph from '../../graph/index';
import { projectContext } from '../../project-context-types';
import { listAllFiles } from '../../notebase/rename';
import type { ConversationDeleteDraft, DeleteDraftItem } from '../../../shared/conversation-refactor-drafts';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

/**
 * propose_folder_delete — the folder counterpart to propose_note_delete. A
 * folder delete is all-or-nothing, so unlike the per-note version it files ONE
 * `folder-delete` proposal for the whole tree. The review card still lists the
 * notes inside (with their inbound-link blast radius) + an asset count so the
 * user sees exactly what's being removed. Never deletes — on Approve the
 * renderer files + applies the `folder-delete` proposal (recoverable via
 * rollback / git).
 */
async function runProposeFolderDelete(
  ctx: ToolContext, input: unknown, callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  if (!callbacks.onDeleteDraft) {
    return { content: 'propose_folder_delete is only available in conversation contexts.', isError: true };
  }
  if (!ctx.conversationId) {
    return { content: 'propose_folder_delete requires a bound conversation id.', isError: true };
  }
  const { path: folderPath } = input as { path?: string };
  if (typeof folderPath !== 'string' || !folderPath.trim()) return { content: 'path is required.', isError: true };
  const dir = folderPath.trim().replace(/^\/+|\/+$/g, '');
  if (!dir) return { content: 'Refusing to delete the project root.', isError: true };

  let stat: import('node:fs').Stats;
  try { stat = await nodeFs.stat(nodePath.join(ctx.rootPath, dir)); }
  catch { return { content: `No such folder: ${dir}`, isError: true }; }
  if (!stat.isDirectory()) return { content: `${dir} is a note, not a folder — use propose_note_delete.`, isError: true };

  const allFiles = await listAllFiles(ctx.rootPath, dir);
  const notes = allFiles.filter((f) => f.endsWith('.md'));
  const assetCount = allFiles.length - notes.length;

  const pctx = projectContext(ctx.rootPath);
  // Inbound links from OUTSIDE the folder — these dangle once it's gone.
  const blockers = graph.findExternalInboundLinks(pctx, notes);
  const inboundByTarget = new Map<string, { source: string; sourceTitle: string; linkCount: number }[]>();
  for (const b of blockers) {
    const list = inboundByTarget.get(b.target) ?? [];
    list.push({ source: b.source, sourceTitle: b.sourceTitle, linkCount: b.linkCount });
    inboundByTarget.set(b.target, list);
  }

  const items: DeleteDraftItem[] = notes.map((p) => ({
    path: p,
    title: graph.noteTitle(pctx, p) || (p.split('/').pop() ?? p),
    inbound: inboundByTarget.get(p) ?? [],
  }));

  const draft: ConversationDeleteDraft = {
    draftId: `delete-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: `Delete folder ${dir}`,
    items,
    warnings: [],
    folderPath: dir,
    assetCount,
    createdAt: new Date().toISOString(),
  };
  callbacks.onDeleteDraft(draft);

  const danglingTotal = items.reduce((n, i) => n + i.inbound.length, 0);
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      folder: dir,
      notesInside: items.length,
      assetsInside: assetCount,
      notesWithInboundLinks: items.filter((i) => i.inbound.length > 0).length,
      danglingLinkSources: danglingTotal,
      hint: 'STOP. The folder deletion is queued for the user to review and approve — nothing has been deleted. ' +
        'End the turn with one short acknowledgement and do NOT call this tool again this turn.',
    }),
    isError: false,
  };
}

export const proposeFolderDelete: NotebaseTool = {
  definition: {
    name: 'propose_folder_delete',
    description:
      'Propose deleting a whole folder and everything inside it (notes AND assets) ' +
      'for the user to review. Use during a cleanup when an entire folder is ' +
      'redundant or superseded — deleting notes one-by-one would leave the folder ' +
      'and its images/attachments behind. The user reviews a card listing the notes ' +
      'inside, how many other notes link into them (those links will dangle), and ' +
      'the asset count, then approves or discards. NOTHING is deleted until approved. ' +
      'Never tell the user to delete a folder by hand — propose it here instead.',
    input_schema: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'The folder\'s thoughtbase-relative path (e.g. "notes/old-topic").' },
      },
      required: ['path'],
    },
  },
  run: (ctx, input, callbacks) => runProposeFolderDelete(ctx, input, callbacks),
};
