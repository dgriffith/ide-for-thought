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

import type { ConversationToolDraft } from './conversation-draft-base';

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

export interface ConversationRefactorDraft extends ConversationToolDraft {
  fromPath: string;
  toPath: string;
  /** The dry-run blast radius — every note whose links would be rewritten. */
  affectedNotes: RefactorAffectedNote[];
  /** True when `fromPath`/`toPath` are folders (propose_folder_move) rather than
   *  a single note. The card labels it "Move folder" and the file handler files
   *  a `folder-refactor` proposal instead of `note-refactor`. */
  isFolder?: boolean;
}

/** One move/rename within a batch reorganization plan (#914). */
export interface ReorgDraftItem {
  fromPath: string;
  toPath: string;
  affectedNotes: RefactorAffectedNote[];
}

/**
 * A batch reorganization plan from `propose_reorganization` (#914) — many
 * moves/renames reviewed as one card with per-item toggles. On Approve, the
 * renderer sends back the SELECTED items via `CONVERSATION_FILE_REORG_DRAFT`,
 * which files them as one ordered note-refactor bundle (atomic — partial failure
 * rolls the whole bundle back).
 */
export interface ConversationReorgDraft extends ConversationToolDraft {
  items: ReorgDraftItem[];
  /** Plan-level problems surfaced before apply (collisions, cycles, skips). */
  warnings: string[];
  /** True when every item is a whole FOLDER move (batched propose_folder_move,
   *  #1778) rather than a note move. The card says "folders" and the file
   *  handler emits `folder-refactor` payloads instead of `note-refactor`.
   *  `affectedNotes` still lists notes either way — for a folder that's the
   *  notes inside it plus the referrers whose links get rewritten. */
  isFolder?: boolean;
}

/** One note proposed for deletion within a `propose_note_delete` batch
 *  (#voice-adjacent reorg cleanup). The card surfaces `inbound` so the user
 *  sees what will be left with dangling links before they approve. */
export interface DeleteDraftItem {
  path: string;
  /** Note title (frontmatter / first heading), falling back to the path. */
  title: string;
  /** Notes OUTSIDE the deletion set that link into this note — i.e. links
   *  that will dangle once it's gone. Empty when nothing points here. */
  inbound: { source: string; sourceTitle: string; linkCount: number }[];
}

/**
 * A batch note-deletion proposed by `propose_note_delete`. Like every other
 * conversation draft, the tool NEVER deletes — it forwards this for review via
 * `Channels.CONVERSATION_DELETE_DRAFT`. On Approve the renderer sends the
 * SELECTED paths back through `Channels.CONVERSATION_FILE_DELETE_DRAFT`, which
 * files + auto-approves a `note_delete` proposal (deletion is recoverable from
 * git, per the project's "delete is a normal operation" stance, but it is
 * always gated on explicit approval).
 */
export interface ConversationDeleteDraft extends ConversationToolDraft {
  items: DeleteDraftItem[];
  /** Per-note problems surfaced before apply (missing file, not a note). */
  warnings: string[];
  /** Set by propose_folder_delete: the folder being deleted whole. `items`
   *  then lists the notes inside it (for the review card + inbound audit), but
   *  the delete is all-or-nothing — the file handler files ONE `folder-delete`
   *  proposal for `folderPath` rather than per-note `note-delete`s. */
  folderPath?: string;
  /** Count of non-note assets (images/pdfs/…) inside `folderPath` that will be
   *  removed with it — surfaced on the card so the user knows. */
  assetCount?: number;
}

