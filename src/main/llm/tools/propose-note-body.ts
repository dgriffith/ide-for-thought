import { randomUUID } from 'node:crypto';
import * as fs from '../../notebase/fs';
import type { ConversationNoteBodyDraft } from '../../../shared/conversation-note-body-drafts';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

/**
 * propose_note_body — like every other propose_* tool, this does NOT write the
 * note (that would violate the trust principle). It reads the current content,
 * builds a before/after ConversationNoteBodyDraft, hands it to the renderer via
 * onNoteBodyDraft, and returns a brief acknowledgement. Approval routes through
 * the `note-rewrite` payload kind (#936) in the IPC handler.
 */
async function runProposeNoteBody(
  ctx: ToolContext, input: unknown, callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  if (!callbacks.onNoteBodyDraft) return { content: 'propose_note_body is only available in conversation contexts.', isError: true };
  if (!ctx.conversationId) return { content: 'propose_note_body requires a bound conversation id.', isError: true };

  const { relative_path, content, note } = input as { relative_path?: unknown; content?: unknown; note?: unknown };
  if (typeof relative_path !== 'string' || !relative_path.trim()) {
    return { content: 'relative_path is required: the thoughtbase-relative path of the note to rewrite.', isError: true };
  }
  if (typeof content !== 'string' || content.length === 0) {
    return { content: 'content is required: the complete new markdown for the note.', isError: true };
  }
  const p = relative_path.trim();
  if (!p.endsWith('.md')) {
    return { content: `Cannot rewrite ${p}: only .md notes can be rewritten.`, isError: true };
  }
  if (!(await fs.fileExists(ctx.rootPath, p))) {
    return { content: `No such note: ${p}. propose_note_body rewrites existing notes — use propose_notes to create a new one.`, isError: true };
  }

  const before = await fs.readFile(ctx.rootPath, p);
  if (before === content) {
    return { content: `The proposed content for ${p} is identical to the current content — nothing to rewrite.`, isError: true };
  }

  const draft: ConversationNoteBodyDraft = {
    draftId: `note-body-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: typeof note === 'string' && note.trim() ? note.trim() : `Rewrite ${p}`,
    relativePath: p,
    beforeContent: before,
    afterContent: content,
    createdAt: new Date().toISOString(),
  };
  callbacks.onNoteBodyDraft(draft);

  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      relativePath: p,
      hint: 'STOP. The rewrite is queued for the user to review as a before/after diff and approve — ' +
        'nothing has been written. End the turn with one short acknowledgement and do NOT call this tool again this turn.',
    }),
    isError: false,
  };
}

export const proposeNoteBody: NotebaseTool = {
  definition: {
    name: 'propose_note_body',
    description:
      'Propose rewriting the full content of an EXISTING note in place, for the ' +
      'user to review as a before/after diff. Use this to flesh out a sparse or ' +
      'dictated stub, restructure a note, tighten prose, or fold in new material — ' +
      'anything that changes a note\'s body. The note must already exist (use ' +
      'propose_notes to create a new one, propose_note_rename to move it). ' +
      'ALWAYS read the note first (read_note) so your rewrite builds on what is ' +
      'there rather than replacing it blindly. Pass the COMPLETE new markdown in ' +
      '`content` — it REPLACES the entire file, so preserve any YAML frontmatter, ' +
      'wiki-links, and tags the note already has unless the user asked to change ' +
      'them, and do not invent facts. NOTHING is written until the user approves ' +
      'the diff; never tell the user to edit the note by hand instead.',
    input_schema: {
      type: 'object',
      properties: {
        relative_path: {
          type: 'string',
          description: 'Thoughtbase-relative path of the existing .md note to rewrite.',
        },
        content: {
          type: 'string',
          description:
            'The complete new markdown for the note (including any frontmatter). ' +
            'This replaces the whole file.',
        },
        note: {
          type: 'string',
          description:
            'Optional one-line summary of the change for the review card header ' +
            '(e.g. "Flesh out the dictated meeting note"). Defaults to "Rewrite <path>".',
        },
      },
      required: ['relative_path', 'content'],
    },
  },
  run: (ctx, input, callbacks) => runProposeNoteBody(ctx, input, callbacks),
};
