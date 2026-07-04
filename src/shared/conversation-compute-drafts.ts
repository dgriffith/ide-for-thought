/**
 * Conversation compute drafts (the `propose_compute` tool path, #245).
 *
 * The LLM mid-conversation calls `propose_compute` with a SPARQL, SQL,
 * or Python cell it would like the user to run. Per the Trust
 * Principle, the tool's server-side execution does NOT run the code —
 * it emits a `ConversationComputeDraft`, the renderer renders an
 * inline reviewable cell, and the user clicks Run (or Insert, or
 * Discard). Only after explicit Run does the executor registry
 * actually dispatch.
 *
 * Counterpart to `conversation-drafts.ts` (notes) and
 * `conversation-source-drafts.ts` (sources). Compute drafts differ in
 * two ways:
 *
 *   1. Three terminal actions, not two — Run, Insert into notebook,
 *      Discard. Run is "approve + execute"; Insert is "approve, file
 *      as a notebook cell, don't execute yet"; Discard is reject.
 *   2. Run produces output that flows back into the conversation as
 *      context for the LLM's next turn. The output is persisted as a
 *      user-role message so the LLM's next inference call sees it
 *      naturally — same shape as a propose_notes 'Filed:' line.
 */
import type { ConversationDraftBase } from './conversation-draft-base';
import type { CellResult } from './compute/types';

/** Languages the proposer can target. Mirrors the compute registry's
 *  registered executors. The tool definition restricts the input to
 *  this union; anything else is rejected at parse time. */
export type ComputeLanguage = 'sparql' | 'sql' | 'python';

/** Hints surfaced when the Python-safety scan finds risky patterns.
 *  Renderer shows them in the card and requires an extra confirm
 *  before the first Run. Not a hard reject — false positives are
 *  fine as long as the user gets to look. */
export interface ComputeSafetyFlag {
  /** Stable id for the flag class (e.g. `imports-os`, `calls-open-write`). */
  id: string;
  /** Human-readable phrase shown on the card ("Imports `os`"). */
  message: string;
}

export interface ConversationComputeDraft extends ConversationDraftBase {
  language: ComputeLanguage;
  /** Cell body, exactly as the LLM produced it. Edited code from the
   *  renderer is sent back through CONVERSATION_RUN_COMPUTE_DRAFT in
   *  the `editedCode` field so the original proposal stays auditable. */
  code: string;
  /** One-sentence "why I'm proposing this" the LLM provided. Surfaced
   *  in the card so the user has context before reading the code. */
  rationale: string;
  /** Empty for sparql/sql; populated for python by the safety scan.
   *  Renderer requires an extra confirm to Run when this is non-empty. */
  safetyFlags: ComputeSafetyFlag[];
}

/** Input shape for `propose_compute`. */
export interface ProposeComputeInput {
  language: ComputeLanguage;
  code: string;
  rationale: string;
}

/** Sent renderer → main when the user clicks Run. The proposal's URI
 *  on the graph is updated to `thought:executed true`; the result is
 *  appended to the conversation log as a user-role context message
 *  so the LLM's next turn sees it. */
export interface RunComputeDraftInput {
  draft: ConversationComputeDraft;
  /** Optional override — when the user edited the cell in the card
   *  before clicking Run. Persisted alongside the original code so
   *  the audit trail captures both. */
  editedCode?: string;
}

export interface RunComputeDraftResult {
  /** Raw cell result from the executor registry. The renderer shows
   *  it as the cell output; the main process also serialises it into
   *  the conversation log so the LLM's next turn picks it up. */
  result: CellResult;
}

/** Sent renderer → main when the user clicks Insert into notebook. */
export interface InsertComputeDraftInput {
  draft: ConversationComputeDraft;
  editedCode?: string;
  /** Project-relative path of the destination note. The renderer
   *  defaults to `notes/inbox/conversations/<conversation-id>.md`;
   *  user can override via a file picker. */
  destinationPath?: string;
}

export interface InsertComputeDraftResult {
  /** The destination path the cell was actually appended to. May
   *  differ from the requested path when the main process applied
   *  collision dedup. */
  destinationPath: string;
}
