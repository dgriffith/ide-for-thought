import { randomUUID } from 'node:crypto';
import * as fs from '../../notebase/fs';
import * as graph from '../../graph/index';
import { projectContext } from '../../project-context-types';
import type { ConversationDeleteDraft } from '../../../shared/conversation-refactor-drafts';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

async function runProposeNoteDelete(
  ctx: ToolContext, input: unknown, callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  if (!callbacks.onDeleteDraft) return { content: 'propose_note_delete is only available in conversation contexts.', isError: true };
  if (!ctx.conversationId) return { content: 'propose_note_delete requires a bound conversation id.', isError: true };

  const { paths } = input as { paths?: unknown };
  if (!Array.isArray(paths) || paths.length === 0) {
    return { content: 'paths is required: a non-empty array of thoughtbase-relative note paths.', isError: true };
  }

  const warnings: string[] = [];
  const valid: string[] = [];
  const seen = new Set<string>();
  for (const raw of paths) {
    if (typeof raw !== 'string' || !raw.trim()) { warnings.push('Skipped a non-string path.'); continue; }
    const p = raw.trim();
    if (seen.has(p)) continue;
    seen.add(p);
    if (!p.endsWith('.md')) { warnings.push(`Skipped ${p}: only .md notes can be deleted.`); continue; }
    if (!(await fs.fileExists(ctx.rootPath, p))) { warnings.push(`Skipped ${p}: no such note.`); continue; }
    valid.push(p);
  }

  if (valid.length === 0) {
    return { content: `No notes could be deleted. ${warnings.join(' ')}`.trim(), isError: true };
  }

  const pctx = projectContext(ctx.rootPath);
  // Inbound links from OUTSIDE the deletion set — these dangle after deletion.
  const blockers = graph.findExternalInboundLinks(pctx, valid);
  const inboundByTarget = new Map<string, { source: string; sourceTitle: string; linkCount: number }[]>();
  for (const b of blockers) {
    const list = inboundByTarget.get(b.target) ?? [];
    list.push({ source: b.source, sourceTitle: b.sourceTitle, linkCount: b.linkCount });
    inboundByTarget.set(b.target, list);
  }

  const items = valid.map((p) => ({
    path: p,
    title: graph.noteTitle(pctx, p) || (p.split('/').pop() ?? p),
    inbound: inboundByTarget.get(p) ?? [],
  }));

  const draft: ConversationDeleteDraft = {
    draftId: `delete-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: `Delete ${items.length} note${items.length === 1 ? '' : 's'}`,
    items,
    warnings,
    createdAt: new Date().toISOString(),
  };
  callbacks.onDeleteDraft(draft);

  const danglingTotal = items.reduce((n, i) => n + i.inbound.length, 0);
  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      notesToDelete: items.length,
      notesWithInboundLinks: items.filter((i) => i.inbound.length > 0).length,
      danglingLinkSources: danglingTotal,
      warnings,
      hint: 'STOP. The deletion is queued for the user to review (per-note) and approve — nothing has been deleted. ' +
        'End the turn with one short acknowledgement and do NOT call this tool again this turn.',
    }),
    isError: false,
  };
}

export const proposeNoteDelete: NotebaseTool = {
  definition: {
    name: 'propose_note_delete',
    description:
      'Propose deleting one or more notes for the user to review. Use this during ' +
      'a cleanup or reorganization when a note is redundant, empty, or superseded ' +
      '(e.g. after merging its content elsewhere) — moving/renaming is not enough. ' +
      'The user reviews a card listing each note and how many other notes link to ' +
      'it (those links will dangle), then approves a subset or discards. NOTHING is ' +
      'deleted until the user approves. Pass every note to remove in ONE call. Never ' +
      'tell the user to delete notes by hand — propose it here instead.',
    input_schema: {
      type: 'object',
      properties: {
        paths: {
          type: 'array',
          minItems: 1,
          maxItems: 200,
          description: 'Thoughtbase-relative paths of the notes to delete (e.g. ["notes/old.md"]).',
          items: { type: 'string' },
        },
      },
      required: ['paths'],
    },
  },
  run: (ctx, input, callbacks) => runProposeNoteDelete(ctx, input, callbacks),
};
