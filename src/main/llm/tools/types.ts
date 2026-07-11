import type { ToolSpec } from '../provider/types';
import type { ConversationDraft } from '../../../shared/conversation-drafts';
import type { ConversationSourceDraft } from '../../../shared/conversation-source-drafts';
import type { ConversationPropertyDraft } from '../../../shared/conversation-property-drafts';
import type { ConversationSourcePropertyDraft } from '../../../shared/conversation-source-property-drafts';
import type { ConversationComputeDraft } from '../../../shared/conversation-compute-drafts';
import type {
  ConversationRefactorDraft,
  ConversationReorgDraft,
  ConversationDeleteDraft,
} from '../../../shared/conversation-refactor-drafts';
import type { ConversationNoteBodyDraft } from '../../../shared/conversation-note-body-drafts';
import type { ConversationClaimsDraft } from '../../../shared/conversation-claims-drafts';

export interface ToolContext {
  rootPath: string;
  /**
   * Identifier of the conversation this tool execution is bound to. Required
   * for any tool that drafts proposals (`propose_notes`) so the draft event
   * can be routed back to the right ConversationDialog. Optional for tools
   * that don't draft.
   */
  conversationId?: string;
}

/**
 * Side-channel callbacks the tool runner can invoke. Wired by the
 * conversation IPC handler — `onDraft` forwards `propose_notes` payloads
 * to the renderer; `askUser` round-trips a question through an inline
 * UI prompt and resolves with the user's reply.
 */
export interface ToolCallbacks {
  onDraft?: (draft: ConversationDraft) => void;
  /** Counterpart to `onDraft` for the `propose_sources` tool. Wired by
   *  the conversation IPC handler; forwards source-ingest drafts to the
   *  renderer via `Channels.CONVERSATION_SOURCE_DRAFT`. Without it,
   *  propose_sources errors with "no UI surface" — same shape as
   *  propose_notes when invoked outside a conversation context. */
  onSourceDraft?: (draft: ConversationSourceDraft) => void;
  /** Counterpart to `onDraft` for the `set_properties` tool. Forwards
   *  frontmatter-patch drafts to the renderer for inline review. */
  onPropertyDraft?: (draft: ConversationPropertyDraft) => void;
  /** Counterpart to `onPropertyDraft` for the `propose_source_properties`
   *  tool (#103). Forwards a source's proposed abstract / TL;DR to the
   *  renderer for inline review before anything touches the meta.ttl. */
  onSourcePropertyDraft?: (draft: ConversationSourcePropertyDraft) => void;
  /** Counterpart to `onDraft` for the `propose_claims` tool (#104). Forwards a
   *  source's extracted key claims (each with a supporting excerpt) to the
   *  renderer for inline review before any node is filed. */
  onClaimsDraft?: (draft: ConversationClaimsDraft) => void;
  /** Counterpart to `onDraft` for the `propose_compute` tool (#245).
   *  Forwards SPARQL / SQL / Python cell drafts to the renderer for
   *  inline review. The user clicks Run / Insert / Discard. */
  onComputeDraft?: (draft: ConversationComputeDraft) => void;
  /** Counterpart to `onDraft` for `propose_note_rename` / `propose_note_move`
   *  (#912). Forwards a note move/rename + its blast radius for inline review. */
  onRefactorDraft?: (draft: ConversationRefactorDraft) => void;
  /** Counterpart for `propose_reorganization` (#914) — a batch move/rename plan
   *  reviewed as one card with per-item toggles. */
  onReorgDraft?: (draft: ConversationReorgDraft) => void;
  /** Counterpart for `propose_note_delete` — a batch deletion reviewed as one
   *  card showing each note's dangling-link blast radius, with per-item toggles. */
  onDeleteDraft?: (draft: ConversationDeleteDraft) => void;
  /** Counterpart for `propose_note_body` (#937) — an in-place rewrite of an
   *  existing note, reviewed as a before/after diff card before anything is
   *  written. */
  onNoteBodyDraft?: (draft: ConversationNoteBodyDraft) => void;
  askUser?: (input: { question: string; choices?: string[] | undefined }) => Promise<string>;
}

export interface ToolResult {
  content: string;
  isError: boolean;
}

export interface NotebaseTool {
  definition: ToolSpec;
  run(ctx: ToolContext, input: unknown, callbacks: ToolCallbacks): Promise<ToolResult> | ToolResult;
}
