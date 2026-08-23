/**
 * Local per-note history (#1158) — shared types across the main store, the IPC
 * contract, and the renderer History panel.
 */

import { describeProposer } from './provenance';

/** How a revision came to exist. `proposal` is populated when an AI-applied
 *  write produces a revision — the cheap #1159 guardrail so a future
 *  provenance-over-time view can correlate note history with gate events. */
export type RevisionOrigin = 'edit' | 'restore' | 'proposal';

export interface RevisionMeta {
  /** Epoch millis the revision was captured (also its stable id). */
  ts: number;
  origin: RevisionOrigin;
  /**
   * Short human description of *what* produced this revision — the "action"
   * column in IntelliJ's Local History ("Auto-tag", "Antithesize", "Restored
   * from Aug 22, 2:07 PM"). Undefined means a plain editor save; the panel
   * falls back to a label derived from `origin` (see `describeRevisionCause`)
   * so revisions captured before this field existed still read sensibly.
   */
  cause?: string;
  /**
   * The note's baseline — the oldest state history knows about, captured
   * before the note's first recorded change. Exempt from pruning: if the
   * baseline ages out, "undo everything back to the start" stops being
   * possible, which is most of the point of keeping history at all.
   */
  initial?: boolean;
  /**
   * SHA-256 of the revision's content (#1836). Lets the next save decide
   * "unchanged, don't capture" by hashing what it already has in memory,
   * instead of reading the previous snapshot off disk on every keystroke pause.
   * Optional: revisions written before this existed have none, and the capture
   * path falls back to comparing content for those.
   */
  hash?: string;
  /** Optional version tag; labeled revisions are exempt from pruning. Stored
   *  from day one so tagging is a UI-only add later, never a migration. */
  label?: string;
}

/**
 * What the write currently in flight should be recorded as. Carried as async
 * context around a write (`runWithHistorySource` in `main/history`) rather than
 * threaded through the whole write pipeline — the pipeline has too many layers
 * between the caller who knows the cause and the hook that records it.
 *
 * Async context, not a module variable (#1833): writes from different callers
 * overlap, so a saved-and-restored global can end up recording one caller's
 * work under another's name.
 */
export interface RevisionSource {
  origin: RevisionOrigin;
  cause?: string;
}

/**
 * Per-machine limits on local note history (#1158) — see
 * `main/history/settings.ts` for storage and defaults.
 */
export interface HistorySettings {
  /** Days an unlabeled revision is kept. */
  retentionDays: number;
  /** Unlabeled revisions kept per note, newest first. */
  maxRevisionsPerNote: number;
  /** Files bigger than this aren't snapshotted at all. `0` = no limit. */
  maxFileSizeKb: number;
}

/**
 * Outcome of labeling the current version of several notes at once. The call
 * succeeds even when individual notes fail (a per-item outcome catalog, not a
 * failure channel): `labeled` is what got a named restore point, `errors`
 * explains each note that didn't.
 */
export interface LabelNotesResult {
  label: string;
  labeled: string[];
  errors: { path: string; error: string }[];
}

/** Display text for a revision's cause, with an origin-derived fallback for
 *  revisions captured before causes were recorded. */
export function describeRevisionCause(rev: Pick<RevisionMeta, 'origin' | 'cause' | 'initial'>): string {
  if (rev.cause) return rev.cause;
  if (rev.initial) return 'Initial version';
  if (rev.origin === 'restore') return 'Restored';
  if (rev.origin === 'proposal') return 'Minerva AI';
  return 'Edit';
}

/** Minerva's own non-conversational write paths, named as the user invoked
 *  them (the menu command, not the module behind it). */
const BUILT_IN_PROPOSER_CAUSES: Record<string, string> = {
  'llm:auto-tag': 'Auto-tag',
  'llm:auto-link': 'Auto-link',
  'llm:auto-link-inbound': 'Auto-link (inbound)',
  'llm:source-properties': 'Source properties',
  'user:attach-evidence': 'Attach evidence',
};

/** Last-resort naming when the proposer stamp says nothing more specific. */
const OPERATION_CAUSES: Record<string, string> = {
  new_claim: 'Claim filed',
  evidence_link: 'Evidence linked',
  component_creation: 'Component added',
  note_refactor: 'Note moved',
  note_delete: 'Note deleted',
  note_rewrite: 'Note rewritten',
  source_properties: 'Source updated',
};

/**
 * Cause text for a revision produced by applying an approved proposal.
 *
 * Preference order: the launching skill's own name ("Antithesize"), then a
 * known built-in write path ("Auto-tag"), then the proposer's label (a fleet
 * agent's name, "CLI", "Minerva AI"), then the operation type. The point is
 * that the timeline row answers "what did this?" the way the user thinks about
 * it — by the command they ran, not by the plumbing that ran it.
 */
export function describeProposalCause(input: {
  proposedBy: string;
  operationType: string;
  /** Name of the skill whose conversation filed the proposal, when known. */
  skillName?: string | undefined;
}): string {
  if (input.skillName) return input.skillName;

  const builtIn = BUILT_IN_PROPOSER_CAUSES[input.proposedBy];
  if (builtIn) return builtIn;

  const proposer = describeProposer(input.proposedBy);
  if (proposer.kind === 'external' || proposer.kind === 'cli') return proposer.label;
  if (proposer.kind === 'internal') {
    return input.proposedBy.startsWith('llm:conversation:') ? 'Conversation' : proposer.label;
  }
  return OPERATION_CAUSES[input.operationType] ?? proposer.label;
}
