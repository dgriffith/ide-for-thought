/**
 * Fields every conversation draft carries (#980). Mid-conversation the LLM emits
 * a draft over a `Channels.CONVERSATION_*_DRAFT` channel; the renderer buckets
 * it by `conversationId`, keys it by `draftId`, and files it on Approve. Each
 * draft kind extends this base with its own payload-specific fields. Compute
 * extends this directly; every other kind extends {@link ConversationToolDraft}
 * to pick up the shared `note`.
 */
export interface ConversationDraftBase {
  /** Stable id wiring Approve/Reject back to the cached bundle; also the render key. */
  draftId: string;
  /** Conversation/tab that produced the draft. The renderer buckets by this. */
  conversationId: string;
  /** ISO timestamp when the draft was created. */
  createdAt: string;
}

/**
 * Base for every *tool* draft — i.e. every draft kind except compute. All of
 * them carry the LLM's one-line rationale for the proposed action, so `note` is
 * defined once here rather than repeated on each kind (#1090). Compute is the
 * exception: its card shows the code + result, not a rationale line, so it
 * extends {@link ConversationDraftBase} directly. Kind-specific fields (the
 * payload list and any pre-apply outcome/problem shapes) are added by each
 * extending interface.
 *
 * Result-shape convention: the payload/outcome collections deliberately stay
 * per-kind rather than hiding behind a generic `<Payload, Outcome>`. The field
 * *names* diverge by intent (`payloads` / `sources` / `claims` / `updates` /
 * `items`), and single-outcome kinds (note-body, source-property) don't share a
 * shape with the many-outcome kinds (sources, reorg). A draft card reads its own
 * kind's field directly; nothing accesses payloads polymorphically across kinds,
 * so a common generic would add ceremony without removing real duplication.
 */
export interface ConversationToolDraft extends ConversationDraftBase {
  /** The LLM's one-line rationale for this draft ("why I'm proposing this"),
   *  shown on the card header. */
  note: string;
}
