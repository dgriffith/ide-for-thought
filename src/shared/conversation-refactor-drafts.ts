/**
 * Conversation refactor drafts — the `propose_note_rename` / `propose_note_move`
 * tool path (#912).
 *
 * Like `propose_notes`, the tool's server-side execution does NOT move the note
 * (that would violate the trust principle). It runs the dry-run `planRename`,
 * forwards a `ConversationRefactorDraft` to the renderer via
 * `Channels.CONVERSATION_REFACTOR_DRAFT`, and tells the model "drafted; the user
 * will review." The review card (#913) renders the blast radius from
 * `affectedNotes`; on Approve, the renderer hands the draft back through
 * `Channels.CONVERSATION_FILE_REFACTOR_DRAFT`, which files + auto-approves a
 * `note-refactor` proposal (#911).
 */

/** One note whose content changes if the refactor is applied — carried so the
 *  review card can show the diff without recomputing the plan. */
export interface RefactorAffectedNote {
  /** Pre-apply path of the affected note. */
  path: string;
  before: string;
  after: string;
  /** True for the note being moved itself (relative links re-relativized). */
  isMoved: boolean;
}

export interface ConversationRefactorDraft {
  draftId: string;
  conversationId: string;
  /** One-line description ("Move a.md → b/a.md"). */
  note: string;
  fromPath: string;
  toPath: string;
  /** The dry-run blast radius — every note whose links would be rewritten. */
  affectedNotes: RefactorAffectedNote[];
  createdAt: string;
}
