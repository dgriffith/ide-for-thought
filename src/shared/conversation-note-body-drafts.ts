/**
 * Conversation note-body drafts — the `propose_note_body` tool path (#937).
 *
 * The in-place-editing tool: the LLM proposes full rewrites of EXISTING notes
 * (e.g. fleshing out a dictated stub — #939). Like every other conversation
 * draft, the tool's server-side execution NEVER writes — that would violate the
 * trust principle. It reads the current content, forwards a
 * `ConversationNoteBodyDraft` (before + after per note) to the renderer via
 * `Channels.CONVERSATION_NOTE_BODY_DRAFT`, and tells the model "drafted; the
 * user will review." The review card (#938) renders a line-by-line diff per
 * note; on Approve the renderer hands back the SELECTED paths through
 * `Channels.CONVERSATION_FILE_NOTE_BODY_DRAFT`, which files + auto-approves ONE
 * `note_rewrite` proposal carrying a `note-rewrite` payload per note (#936) and
 * broadcasts NOTEBASE_REWRITTEN so open editors reload.
 *
 * **One draft, many notes.** A request that touches twenty notes is one card
 * and one proposal, not twenty. The approval engine has always been
 * bundle-native (`ProposedWrite.payloads` is an array, applied in order by
 * `applyBundle` with reverse-order rollback) — this draft shape is what lets
 * the rewrite path use it. The win is as much atomicity as tidiness: a
 * half-applied batch of twenty rewrites is a genuinely bad state, and a bundle
 * rolls back instead of leaving one.
 */

import type { ConversationToolDraft } from './conversation-draft-base';

/** One note's proposed rewrite. `relativePath` is the identity used for
 *  selection on the card and for the payload built on approve. */
export interface NoteBodyDraftItem {
  /** Thoughtbase-relative path of the existing note being rewritten. */
  relativePath: string;
  /** The note's current full content (frontmatter + body), for the diff's
   *  "before" side and for the user to compare against. */
  beforeContent: string;
  /** The proposed replacement content — REPLACES the whole file on approve. */
  afterContent: string;
}

export interface ConversationNoteBodyDraft extends ConversationToolDraft {
  /** One entry per note to rewrite; at least one. */
  items: NoteBodyDraftItem[];
  /** Per-note problems found while building the draft (missing note, not a
   *  `.md`, content identical to what's on disk). Surfaced on the card so a
   *  partially-rejected batch explains itself rather than silently shrinking. */
  warnings: string[];
}

/** Result of approving (or discarding) a note-body rewrite. */
export interface FileNoteBodyDraftResult {
  proposalUri: string | null;
  applied: boolean;
}
