import { randomUUID } from 'node:crypto';
import * as fs from '../../notebase/fs';
import type {
  ConversationNoteBodyDraft,
  NoteBodyDraftItem,
} from '../../../shared/conversation-note-body-drafts';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';

/**
 * propose_note_body — like every other propose_* tool, this does NOT write the
 * notes (that would violate the trust principle). It reads the current content
 * of each note, builds a before/after ConversationNoteBodyDraft, hands it to
 * the renderer via onNoteBodyDraft, and returns a brief acknowledgement.
 * Approval routes through the `note-rewrite` payload kind (#936) in the IPC
 * handler, which files ONE bundled proposal for the whole batch.
 *
 * Takes an `edits` array so a request that touches many notes is one review
 * card and one proposal. Per-note problems are collected as warnings rather
 * than failing the call: one bad path in a batch of twenty shouldn't discard
 * the nineteen good rewrites the model just produced.
 */
async function runProposeNoteBody(
  ctx: ToolContext, input: unknown, callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  if (!callbacks.onNoteBodyDraft) return { content: 'propose_note_body is only available in conversation contexts.', isError: true };
  if (!ctx.conversationId) return { content: 'propose_note_body requires a bound conversation id.', isError: true };

  const { edits, note } = input as { edits?: unknown; note?: unknown };
  if (!Array.isArray(edits) || edits.length === 0) {
    return {
      content: 'edits is required: a non-empty array of { relative_path, content } objects, one per note to rewrite.',
      isError: true,
    };
  }

  const items: NoteBodyDraftItem[] = [];
  const warnings: string[] = [];
  const seen = new Set<string>();

  for (const raw of edits) {
    const { relative_path, content } = (raw ?? {}) as { relative_path?: unknown; content?: unknown };
    if (typeof relative_path !== 'string' || !relative_path.trim()) {
      warnings.push('Skipped an edit with no relative_path.');
      continue;
    }
    const p = relative_path.trim();
    if (typeof content !== 'string' || content.length === 0) {
      warnings.push(`Skipped ${p}: content is required (the complete new markdown).`);
      continue;
    }
    if (!p.endsWith('.md')) {
      warnings.push(`Skipped ${p}: only .md notes can be rewritten.`);
      continue;
    }
    // A repeated path would mean two rewrites of one note in a single bundle —
    // the second silently winning. Keep the first and say so.
    if (seen.has(p)) {
      warnings.push(`Skipped a duplicate edit for ${p}; kept the first.`);
      continue;
    }
    if (!(await fs.fileExists(ctx.rootPath, p))) {
      warnings.push(`Skipped ${p}: no such note. propose_note_body rewrites existing notes — use propose_notes to create one.`);
      continue;
    }
    const before = await fs.readFile(ctx.rootPath, p);
    if (before === content) {
      warnings.push(`Skipped ${p}: the proposed content is identical to the current content.`);
      continue;
    }
    seen.add(p);
    items.push({ relativePath: p, beforeContent: before, afterContent: content });
  }

  if (items.length === 0) {
    // Nothing survived — report why rather than opening an empty review card.
    return {
      content: `No rewrites to propose.\n${warnings.join('\n')}`,
      isError: true,
    };
  }

  const summary = items.length === 1
    ? `Rewrite ${items[0]!.relativePath}`
    : `Rewrite ${items.length} notes`;

  const draft: ConversationNoteBodyDraft = {
    draftId: `note-body-${randomUUID()}`,
    conversationId: ctx.conversationId,
    note: typeof note === 'string' && note.trim() ? note.trim() : summary,
    items,
    warnings,
    createdAt: new Date().toISOString(),
  };
  callbacks.onNoteBodyDraft(draft);

  return {
    content: JSON.stringify({
      status: 'drafted',
      draftId: draft.draftId,
      paths: items.map((i) => i.relativePath),
      ...(warnings.length > 0 ? { skipped: warnings } : {}),
      hint: 'STOP. The rewrites are queued for the user to review as before/after diffs and approve — ' +
        'nothing has been written. End the turn with one short acknowledgement and do NOT call this tool again this turn.',
    }),
    isError: false,
  };
}

export const proposeNoteBody: NotebaseTool = {
  definition: {
    name: 'propose_note_body',
    description:
      'Propose rewriting the full content of one or more EXISTING notes in place, ' +
      'for the user to review as before/after diffs. Use this to flesh out a sparse ' +
      'or dictated stub, restructure a note, tighten prose, or fold in new material — ' +
      'anything that changes a note\'s body. Each note must already exist (use ' +
      'propose_notes to create one, propose_note_rename to move it). ' +
      'ALWAYS read a note first (read_note) so your rewrite builds on what is ' +
      'there rather than replacing it blindly. Pass the COMPLETE new markdown in ' +
      'each edit\'s `content` — it REPLACES the entire file, so preserve any YAML ' +
      'frontmatter, wiki-links, and tags the note already has unless the user asked ' +
      'to change them, and do not invent facts. ' +
      'Call this ONCE per turn with ALL the notes you want to rewrite in `edits` — ' +
      'the batch becomes a single review card and a single all-or-nothing change, ' +
      'so do not call it once per note. NOTHING is written until the user approves; ' +
      'never tell the user to edit a note by hand instead.',
    input_schema: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          description:
            'One entry per note to rewrite. Include every note you intend to change ' +
            'in this one call.',
          items: {
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
            },
            required: ['relative_path', 'content'],
          },
        },
        note: {
          type: 'string',
          description:
            'Optional one-line summary of the change for the review card header ' +
            '(e.g. "Flesh out the dictated meeting notes"). Defaults to a generated summary.',
        },
      },
      required: ['edits'],
    },
  },
  run: (ctx, input, callbacks) => runProposeNoteBody(ctx, input, callbacks),
};
