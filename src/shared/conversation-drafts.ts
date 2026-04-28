/**
 * Conversation drafts (the `propose_notes` tool path).
 *
 * The LLM, mid-conversation, can call the `propose_notes` tool with
 * one or more `note` payloads. The tool's *server-side* execution does
 * NOT file the bundle — that would violate the trust principle ("LLM
 * proposes, human approves"). Instead it generates a `ConversationDraft`,
 * forwards it to the renderer via `Channels.CONVERSATION_DRAFT`, and
 * returns to the model: "drafted; the user will review."
 *
 * The renderer caches drafts per conversation and renders them as inline
 * cards beneath the assistant message. When the user clicks Approve in
 * a card, the renderer hands the bundle back through
 * `Channels.CONVERSATION_FILE_DRAFT` — that handler files the Proposal
 * AND auto-approves it (the user already reviewed; a second approval
 * gate in the Proposals panel would be redundant).
 *
 * Drafts live in renderer memory and are dropped when the conversation
 * dialog closes. Persistence across reload is a follow-up.
 */

export interface DraftNotePayload {
  kind: 'note';
  /** Project-relative target path. The approval engine handles collision dedup at apply time. */
  relativePath: string;
  content: string;
}

export type DraftPayload = DraftNotePayload;

export interface ConversationDraft {
  /** Stable id used to wire Approve/Reject buttons back to the cached bundle. */
  draftId: string;
  /** Conversation that produced the draft. Used by the renderer to bucket. */
  conversationId: string;
  /** One-line description the LLM provided when calling propose_notes ("why I'm proposing this"). */
  note: string;
  payloads: DraftPayload[];
  /** ISO timestamp when the draft was created. */
  createdAt: string;
}

/** Tool input parsed by the propose_notes execution. Shape exposed to the LLM. */
export interface ProposeNotesInput {
  note: string;
  payloads: DraftPayload[];
}
