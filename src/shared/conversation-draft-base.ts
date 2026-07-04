/**
 * Fields every conversation draft carries (#980). Mid-conversation the LLM emits
 * a draft over a `Channels.CONVERSATION_*_DRAFT` channel; the renderer buckets
 * it by `conversationId`, keys it by `draftId`, and files it on Approve. Each
 * draft kind extends this base with its own payload-specific fields (and most,
 * but not compute, add a one-line `note`).
 */
export interface ConversationDraftBase {
  /** Stable id wiring Approve/Reject back to the cached bundle; also the render key. */
  draftId: string;
  /** Conversation/tab that produced the draft. The renderer buckets by this. */
  conversationId: string;
  /** ISO timestamp when the draft was created. */
  createdAt: string;
}
