import type { NoteBodyDraftItem } from '../../../shared/conversation-note-body-drafts';
import type { NotebaseTool, ToolContext, ToolCallbacks } from './types';
import { fileNoteBodyDraft, readNoteForEdit } from './propose-note-body';

/**
 * propose_note_edits — anchored replacements inside existing notes (#1816).
 *
 * `propose_note_body` takes the complete new file, so revising a long note means
 * emitting all of it as tool input in one turn; a turn that hits its output cap
 * partway through the call drafts nothing (#1749). Here the model sends only the
 * passages that change — `old_text` → `new_text` — so its output is proportional
 * to the edit, not to the note.
 *
 * Nothing new downstream: each edit is spliced into the note's CURRENT content
 * here, and the result goes out as the same before/after `ConversationNoteBodyDraft`
 * the whole-file tool produces — the same review card, the same bundled
 * `note-rewrite` proposal, nothing written until the user approves.
 *
 * Matching is exact and must be unique. A note whose edits don't all apply is
 * skipped whole, with the reason, rather than drafted half-edited: a card showing
 * three of four intended changes reads as complete and isn't.
 */

interface Edit { old_text: string; new_text: string }

/** Apply `edits` in order to `text`. Exact, unique matches only; the first edit
 *  that can't apply fails the whole note. Line endings follow the note: a model
 *  writes `\n`, and a CRLF note would otherwise never match. */
export function applyAnchoredEdits(text: string, edits: Edit[]): { after: string } | { problem: string } {
  const crlf = text.includes('\r\n');
  const eol = (s: string) => (crlf && !s.includes('\r\n') ? s.replace(/\n/g, '\r\n') : s);
  let out = text;
  for (const [i, e] of edits.entries()) {
    const n = edits.length > 1 ? ` (edit ${i + 1} of ${edits.length})` : '';
    const oldText = eol(e.old_text);
    const first = out.indexOf(oldText);
    if (first < 0) {
      return { problem: `old_text${n} was not found verbatim — copy it exactly from read_note (whitespace and punctuation included): "${preview(e.old_text)}"` };
    }
    if (out.indexOf(oldText, first + 1) >= 0) {
      const count = out.split(oldText).length - 1;
      return { problem: `old_text${n} matches ${count} places — include enough surrounding text to pick out one: "${preview(e.old_text)}"` };
    }
    out = out.slice(0, first) + eol(e.new_text) + out.slice(first + oldText.length);
  }
  return { after: out };
}

function preview(s: string): string {
  const flat = s.replace(/\s+/g, ' ').trim();
  return flat.length > 80 ? `${flat.slice(0, 77)}…` : flat;
}

async function runProposeNoteEdits(
  ctx: ToolContext, input: unknown, callbacks: ToolCallbacks,
): Promise<{ content: string; isError: boolean }> {
  const onNoteBodyDraft = callbacks.onNoteBodyDraft;
  if (!onNoteBodyDraft) return { content: 'propose_note_edits is only available in conversation contexts.', isError: true };
  const conversationId = ctx.conversationId;
  if (!conversationId) return { content: 'propose_note_edits requires a bound conversation id.', isError: true };

  const { edits, note } = input as { edits?: unknown; note?: unknown };
  if (!Array.isArray(edits) || edits.length === 0) {
    return {
      content: 'edits is required: a non-empty array of { relative_path, old_text, new_text } objects.',
      isError: true,
    };
  }

  // Group by note, keeping the model's order within each: edits to one note
  // apply in sequence, and notes appear on the card in first-mention order.
  const warnings: string[] = [];
  const byNote = new Map<string, Edit[]>();
  for (const raw of edits) {
    const { relative_path, old_text, new_text } = (raw ?? {}) as Record<string, unknown>;
    const label = typeof relative_path === 'string' && relative_path.trim() ? relative_path.trim() : null;
    if (!label) { warnings.push('Skipped an edit with no relative_path.'); continue; }
    if (typeof old_text !== 'string' || old_text.length === 0) {
      warnings.push(`Skipped an edit to ${label}: old_text is required — the exact passage to replace. To add text, anchor on the line it goes after and repeat that line in new_text.`);
      continue;
    }
    if (typeof new_text !== 'string') { warnings.push(`Skipped an edit to ${label}: new_text is required (use "" to delete the passage).`); continue; }
    if (old_text === new_text) { warnings.push(`Skipped an edit to ${label}: old_text and new_text are identical.`); continue; }
    const list = byNote.get(label) ?? [];
    list.push({ old_text, new_text });
    byNote.set(label, list);
  }

  const items: NoteBodyDraftItem[] = [];
  for (const [label, noteEdits] of byNote) {
    const read = await readNoteForEdit(ctx, label, 'propose_note_edits');
    if ('warning' in read) { warnings.push(read.warning); continue; }
    const applied = applyAnchoredEdits(read.before, noteEdits);
    if ('problem' in applied) {
      warnings.push(`Skipped ${read.path}: ${applied.problem}. No edits to this note were drafted.`);
      continue;
    }
    items.push({ relativePath: read.path, beforeContent: read.before, afterContent: applied.after });
  }

  return fileNoteBodyDraft({ ...ctx, conversationId }, { ...callbacks, onNoteBodyDraft }, items, warnings, note, 'No edits to propose.');
}

export const proposeNoteEdits: NotebaseTool = {
  definition: {
    name: 'propose_note_edits',
    description:
      'Propose targeted changes to parts of one or more EXISTING notes, for the user to ' +
      'review as before/after diffs. Each edit replaces one exact passage (`old_text`) ' +
      'with new text (`new_text`), so you send only what changes. PREFER THIS over ' +
      'propose_note_body for any change that leaves most of a note as it is — tightening ' +
      'a section, fixing a paragraph, adding a few lines under a heading, deleting a ' +
      'passage — and ALWAYS for a long note: propose_note_body has to emit the whole file ' +
      'in one reply and can run out of room partway, drafting nothing. ' +
      'ALWAYS read_note first and copy `old_text` EXACTLY from it (whitespace and ' +
      'punctuation included); it must match exactly one place in the note, so include ' +
      'enough surrounding text to make it unique. Edits to the same note apply in order. ' +
      'If any edit to a note fails to match, that note is skipped whole and you are told ' +
      'why. To insert text, anchor on the line it should follow and repeat that line at ' +
      'the start of new_text; to delete, use an empty new_text. ' +
      'Call this ONCE per turn with ALL your edits — they become a single review card and ' +
      'a single all-or-nothing change. NOTHING is written until the user approves.',
    input_schema: {
      type: 'object',
      properties: {
        edits: {
          type: 'array',
          description: 'Every passage you intend to change, across all notes, in this one call.',
          items: {
            type: 'object',
            properties: {
              relative_path: {
                type: 'string',
                description: 'Thoughtbase-relative path of the existing .md note.',
              },
              old_text: {
                type: 'string',
                description: 'The exact current text to replace, copied from read_note. Must occur exactly once in the note.',
              },
              new_text: {
                type: 'string',
                description: 'The replacement text. Empty string deletes the passage.',
              },
            },
            required: ['relative_path', 'old_text', 'new_text'],
          },
        },
        note: {
          type: 'string',
          description:
            'Optional one-line summary of the change for the review card header ' +
            '(e.g. "Tighten the opening section"). Defaults to a generated summary.',
        },
      },
      required: ['edits'],
    },
  },
  run: (ctx, input, callbacks) => runProposeNoteEdits(ctx, input, callbacks),
};
