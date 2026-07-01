/**
 * Conversation note-body drafts — the `propose_note_body` tool path (#937).
 *
 * The first in-place-editing tool: the LLM proposes a full rewrite of an
 * EXISTING note's content (e.g. fleshing out a dictated stub — #939). Like
 * every other conversation draft, the tool's server-side execution NEVER
 * writes the note — that would violate the trust principle. It reads the
 * current content, forwards a `ConversationNoteBodyDraft` (before + after) to
 * the renderer via `Channels.CONVERSATION_NOTE_BODY_DRAFT`, and tells the model
 * "drafted; the user will review." The review card (#938) renders the
 * line-by-line diff; on Approve the renderer hands the draft back through
 * `Channels.CONVERSATION_FILE_NOTE_BODY_DRAFT`, which files + auto-approves a
 * `note_rewrite` proposal (the `note-rewrite` payload kind, #936) and broadcasts
 * NOTEBASE_REWRITTEN so an open editor reloads the new content.
 */

export interface ConversationNoteBodyDraft {
  draftId: string;
  conversationId: string;
  /** One-line summary for the card header (e.g. "Fill out notes/stub.md"). */
  note: string;
  /** Thoughtbase-relative path of the existing note being rewritten. */
  relativePath: string;
  /** The note's current full content (frontmatter + body), for the diff's
   *  "before" side and for the user to compare against. */
  beforeContent: string;
  /** The proposed replacement content — REPLACES the whole file on approve. */
  afterContent: string;
  createdAt: string;
}

/** Result of approving (or discarding) a note-body rewrite. */
export interface FileNoteBodyDraftResult {
  proposalUri: string | null;
  applied: boolean;
}
