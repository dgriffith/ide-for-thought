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

import type { ConversationToolDraft } from './conversation-draft-base';

export interface DraftNotePayload {
  kind: 'note';
  /** Project-relative target path. The approval engine handles collision dedup at apply time. */
  relativePath: string;
  content: string;
}

export type DraftPayload = DraftNotePayload;

export interface ConversationDraft extends ConversationToolDraft {
  payloads: DraftPayload[];
}

/** Tool input parsed by the propose_notes execution. Shape exposed to the LLM. */
export interface ProposeNotesInput {
  note: string;
  payloads: DraftPayload[];
}

/** Result returned by `CONVERSATION_FILE_DRAFT` after Approve. The renderer
 *  uses `filedPaths` to render a compact "Filed: foo.md · bar.md" line in
 *  place of the draft card so the user knows exactly which notes landed —
 *  collision dedup at apply time means the path may differ from the
 *  proposed `relativePath`, so we surface what was actually written. */
export interface FileDraftResult {
  proposalUri: string | null;
  applied: boolean;
  filedPaths: string[];
}
