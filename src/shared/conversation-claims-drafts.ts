/**
 * Conversation claim-extraction drafts (the `propose_claims` tool path, #104).
 *
 * Counterpart to `conversation-source-property-drafts.ts`. The LLM, reading a
 * Source's body, calls `propose_claims` with the key claims it found — each a
 * `{ text, kind, quote, confidence }`. The tool (server side) does NOT write:
 * it locates each quote in `body.md`, computes the excerpt id + char offsets,
 * and emits a `ConversationClaimsDraft` for inline review
 * (`Channels.CONVERSATION_CLAIMS_DRAFT`).
 *
 * On Approve the renderer hands the draft back via
 * `Channels.CONVERSATION_FILE_CLAIMS_DRAFT`; that handler files, through the
 * approval engine, one bundle per source: a `thought:Excerpt` node per quote
 * (anchored by char offsets into body.md) and a `thought:Claim` note per claim
 * that quotes its excerpt (`[[quote::id]]` → `thought:quotes`) and carries its
 * confidence. Trust principle: the card click is the human-confirm gate.
 *
 * Drafts live in renderer memory and drop when the tab closes.
 */

import type { ConversationDraftBase } from './conversation-draft-base';

export type ClaimKind = 'factual' | 'evaluative' | 'definitional' | 'predictive';

export const CLAIM_KINDS: readonly ClaimKind[] = [
  'factual', 'evaluative', 'definitional', 'predictive',
];

/** One proposed claim + its supporting excerpt, resolved against body.md. */
export interface DraftClaim {
  /** The claim, as a concise assertion. */
  text: string;
  kind: ClaimKind;
  /** Verbatim supporting passage copied from the source body. */
  quote: string;
  /** 0–1 confidence the model assigns to the claim. */
  confidence: number;
  /** Deterministic excerpt id for (sourceId, quote) — computed server side. */
  excerptId: string;
  /** 0-based char offsets of the quote in body.md, when it matched verbatim. */
  charStart?: number;
  charEnd?: number;
  /** False when the quote was not a verbatim substring of the body — the
   *  excerpt still files (quote-anchored) but without offsets; the card flags it. */
  quoteFound: boolean;
}

export interface ConversationClaimsDraft extends ConversationDraftBase {
  /** Bundle-level "why I'm proposing these" note from the LLM. */
  note: string;
  /** The source the claims were extracted from. */
  sourceId: string;
  claims: DraftClaim[];
}

/** Result returned by `CONVERSATION_FILE_CLAIMS_DRAFT`. */
export interface ClaimsOutcome {
  sourceId: string;
  /** Project-relative paths of the filed claim notes. */
  claimPaths: string[];
  /** Excerpt ids filed (or already present). */
  excerptIds: string[];
  /** Error message when the bundle failed to apply. */
  error?: string;
}

export interface FileClaimsDraftResult {
  outcome: ClaimsOutcome;
}

/** Input shape for the `propose_claims` tool. */
export interface ProposeClaimsInput {
  note: string;
  sourceId: string;
  claims: Array<{ text: string; kind: ClaimKind; quote: string; confidence: number }>;
}
