import { randomUUID } from 'node:crypto';
import nodeFs from 'node:fs/promises';
import nodePath from 'node:path';
import * as graph from '../../graph/index';
import { projectContext } from '../../project-context-types';
import { listAllFiles } from '../../notebase/rename';
import type { ConversationDeleteDraft, DeleteDraftItem } from '../../../shared/conversation-refactor-drafts';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

/**
 * propose_folder_delete — the folder counterpart to propose_note_delete. Each
 * folder is all-or-nothing, so unlike the per-note version it files one
 * `folder-delete` payload per folder rather than per-note deletes. A batch of
 * folders is ONE proposal carrying one payload each (#1778): the bundle applies
 * in order and rolls all of them back together, so a cleanup can't half-finish.
 *
 * The review card still lists the notes inside each folder (with their
 * inbound-link blast radius) + an asset count, so the user sees exactly what's
 * being removed. Never deletes — on Approve the renderer files + applies the
 * proposal (recoverable via rollback / git).
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
  const { paths } = input as { paths?: unknown };
  if (!Array.isArray(paths) || paths.length === 0) {
    return { content: 'paths is required: a non-empty array of folder paths.', isError: true };
  }

  const warnings: string[] = [];
  const candidates: string[] = [];
  const seen = new Set<string>();

  for (const raw of paths) {
    if (typeof raw !== 'string' || !raw.trim()) {
      warnings.push('Skipped an entry that was not a folder path.');
      continue;
    }
    const dir = raw.trim().replace(/^\/+|\/+$/g, '');
    if (!dir) return { content: 'Refusing to delete the project root.', isError: true };
    if (seen.has(dir)) {
      warnings.push(`Skipped a duplicate entry for ${dir}.`);
      continue;
    }

    let stat: import('node:fs').Stats;
    try { stat = await nodeFs.stat(nodePath.join(ctx.rootPath, dir)); }
    catch { warnings.push(`Skipped ${dir}: no such folder.`); continue; }
    if (!stat.isDirectory()) {
      warnings.push(`Skipped ${dir}: it's a note, not a folder — use propose_note_delete.`);
      continue;
    }
    seen.add(dir);
    candidates.push(dir);
  }

  // Drop any folder already covered by another in the batch. Deleting the
  // parent removes the child anyway, and the child's own payload would then
  // fail on a missing path and roll the whole bundle back.
  const folders = candidates.filter((dir) => {
    const parent = candidates.find((other) => other !== dir && dir.startsWith(`${other}/`));
    if (parent) {
      warnings.push(`Skipped ${dir}: already inside ${parent}, which is being deleted.`);
      return false;
    }
    return true;
  });

  if (folders.length === 0) {
    return { content: `No folders to delete.\n${warnings.join('\n')}`.trim(), isError: true };
  }

  const pctx = projectContext(ctx.rootPath);
  const items: DeleteDraftItem[] = [];
  let assetCount = 0;
  // Inbound links are audited against the WHOLE deletion set, so a link from
  // one doomed folder into another isn't reported as about-to-dangle.
  const allNotes: string[] = [];
  const notesByFolder = new Map<string, string[]>();
  for (const dir of folders) {
    const allFiles = await listAllFiles(ctx.rootPath, dir);
    const notes = allFiles.filter((f) => f.endsWith('.md'));
    assetCount += allFiles.length - notes.length;
    notesByFolder.set(dir, notes);
    allNotes.push(...notes);
  }

  const blockers = graph.findExternalInboundLinks(pctx, allNotes);
  const inboundByTarget = new Map<string, { source: string; sourceTitle: string; linkCount: number }[]>();
  for (const b of blockers) {
    const list = inboundByTarget.get(b.target) ?? [];
    list.push({ source: b.source, sourceTitle: b.sourceTitle, linkCount: b.linkCount });
    inboundByTarget.set(b.target, list);
  }

  for (const dir of folders) {
    for (const p of notesByFolder.get(dir) ?? []) {
      items.push({
        path: p,
        title: graph.noteTitle(pctx, p) || (p.split('/').pop() ?? p),
        inbound: inboundByTarget.get(p) ?? [],
        folder: dir,
      });
    }
  }

  const draft: ConversationDeleteDraft = {
    draftId: `delete-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: folders.length === 1 ? `Delete folder ${folders[0]}` : `Delete ${folders.length} folders`,
    items,
    warnings,
    folderPaths: folders,
    assetCount,
    createdAt: new Date().toISOString(),
  };
  callbacks.onDeleteDraft(draft);

  const danglingTotal = items.reduce((n, i) => n + i.inbound.length, 0);
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      folders,
      notesInside: items.length,
      assetsInside: assetCount,
      notesWithInboundLinks: items.filter((i) => i.inbound.length > 0).length,
      danglingLinkSources: danglingTotal,
      ...(warnings.length > 0 ? { skipped: warnings } : {}),
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
      'Propose deleting whole folders and everything inside them (notes AND assets) ' +
      'for the user to review. Use during a cleanup when entire folders are ' +
      'redundant or superseded — deleting notes one-by-one would leave the folders ' +
      'and their images/attachments behind. The user reviews a card listing the notes ' +
      'inside, how many other notes link into them (those links will dangle), and ' +
      'the asset count, then approves or discards. ' +
      'Call this ONCE per turn with ALL the folders you want to delete in `paths` — ' +
      'a batch becomes a single review card and a single all-or-nothing change, so ' +
      'do not call it once per folder. NOTHING is deleted until approved. ' +
      'Never tell the user to delete a folder by hand — propose it here instead.',
    input_schema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          minItems: 1,
          maxItems: 100,
          description: 'One entry per folder to delete, thoughtbase-relative (e.g. "notes/old-topic"). Include every folder in this one call.',
          items: { type: 'string' },
        },
      },
      required: ['paths'],
    },
  },
  run: (ctx, input, callbacks) => runProposeFolderDelete(ctx, input, callbacks),
};
