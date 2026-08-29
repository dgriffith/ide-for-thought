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

/**
 * Design decision (#1911): the draft-kind family stays as nine explicit
 * channel pairs, not one parameterised pair. Recorded here because this file
 * is the "half-built discriminant" the issue pointed at — the base type
 * exists; the decision below is why it was never carried further into a
 * generic dispatch.
 *
 * What's actually duplicated across the five layers (21 channel constants,
 * matching `ChannelMap`/`EventMap` entries, ~19 preload passthroughs, the
 * client interface, 11 main-process handlers, 9 approve + 9 discard store
 * functions) was already measured and split into two categories before this
 * issue was picked up:
 *
 *  - **Genuinely repeated LOGIC** — "file a write proposal and immediately
 *    approve it" (main process) and "call the API, and on success drop the
 *    card" (renderer store) — was real duplication and got extracted:
 *    `fileAndApprove()` in `main/ipc/register-conversation-drafts.ts` (#1895)
 *    and `approveFrom()` / `discardFrom()` in `stores/conversations.svelte.ts`
 *    (#1896). That closed the actual repeated-logic gap.
 *  - **What's left is mechanical SHAPE, not logic** — one channel constant,
 *    one `ChannelMap` entry, one preload passthrough (literally
 *    `x: (draft) => invoke(Channels.X, draft)`), one client interface method,
 *    per kind. Each is one line, fully type-checked end-to-end via
 *    `Parameters<ChannelMap[K]>`, and already about as low-risk as IPC wiring
 *    gets.
 *
 * Collapsing the remaining shape into one `kind`-discriminated channel pair
 * was evaluated and rejected:
 *
 *  1. It doesn't fit the same "no generic `<Payload, Outcome>`" reasoning
 *     this file already recorded for the TYPE layer (#1090, above) — the
 *     payload-construction logic inside each main-process handler and each
 *     store approve function genuinely differs per kind (different
 *     validation, different side effects, different result shapes), and
 *     compute doesn't even follow the "approve" shape at all — it has RUN
 *     and INSERT, not a single approve verb. A parameterised channel would
 *     still need a `switch` dispatching to ~9 distinct implementations
 *     inside one handler, which is strictly less legible than 9 separate,
 *     independently-readable `handle()` registrations — not a reduction in
 *     real complexity, just a relocation of it.
 *  2. Preserving per-kind type safety through a single generic channel
 *     requires either a call signature generic over a runtime `kind`
 *     argument (unlike every other entry in `ChannelMap`, and real added
 *     complexity to save four one-line entries) or a loosely-typed payload
 *     narrowed at runtime — which is exactly the "weaken per-kind type
 *     safety at the approval boundary" outcome the issue itself warned
 *     against.
 *  3. This is the LLM approve-and-apply surface (the Trust Principle's
 *     enforcement point). Explicit per-kind channels are independently
 *     greppable ("does `CONVERSATION_FILE_CLAIMS_DRAFT` reach
 *     `approveProposal`? — right there") and independently testable (see
 *     `tests/main/ipc/register-conversation-drafts.test.ts`, #1900). A bug in
 *     a shared dispatch table would risk all nine kinds at once instead of
 *     staying isolated to one — a worse failure mode at a trust boundary than
 *     the file-count cost of the status quo.
 *
 * Net: status quo. Adding a tenth draft kind still touches on the order of
 * five to seven files, but — thanks to #1895/#1896 — each touch is now a
 * single obvious line rather than hand-copied logic. The ≤2-file target this
 * issue posed was evaluated and knowingly not adopted; auditability at the
 * approval boundary outweighs the file-count reduction here.
 */
