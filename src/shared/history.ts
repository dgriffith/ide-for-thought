/**
 * Local per-note history (#1158) — shared types across the main store, the IPC
 * contract, and the renderer History panel.
 */

import { describeProposer } from './provenance';

/** How a revision came to exist. `proposal` is populated when an AI-applied
 *  write produces a revision — the cheap #1159 guardrail so a future
 *  provenance-over-time view can correlate note history with gate events.
 *  `delete` (#2089) is a pure marker recording that the note stopped existing
 *  at this moment — no `.snap` file, no `hash`, nothing to diff or restore
 *  from directly; it exists so a later "as of T" query across a set of notes
 *  can tell "didn't exist yet" apart from "existed, then was removed". */
export type RevisionOrigin = 'edit' | 'restore' | 'proposal' | 'delete';

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

/**
 * A user's selection in the sidebar tree, before it's been expanded to the
 * live note files underneath it (#2090) — a single file or a whole
 * directory. The renderer expands directories to live paths itself
 * (`expandSelectionToNotes`); the backend only needs the raw roots to know
 * which directories to search for ORPHANED (deleted) note histories that
 * don't appear in the live tree at all.
 */
export interface SelectionRoot {
  relativePath: string;
  isDirectory: boolean;
}

/** One revision, tagged with which note it belongs to and how it reads in a
 *  unified, multi-note timeline (#2090) — the merge of several notes'
 *  independent revision logs into one sorted list. */
export interface UnifiedTimelineEntry extends RevisionMeta {
  /** Project-relative path of the note this revision belongs to. */
  path: string;
  event: 'added' | 'modified' | 'deleted';
}

/**
 * How a single revision reads as a timeline event. `added` is the note's
 * baseline (its first recorded state — "this note appeared"), `deleted` is
 * a pure delete marker (#2089), everything else is an ordinary content
 * change. Per-revision only — it doesn't look at neighboring revisions, so a
 * note recreated after deletion reads as `modified` for its next save, not
 * `added` again (the baseline stays whichever revision was first).
 */
export function classifyHistoryEvent(rev: Pick<RevisionMeta, 'origin' | 'initial'>): 'added' | 'modified' | 'deleted' {
  if (rev.origin === 'delete') return 'deleted';
  if (rev.initial) return 'added';
  return 'modified';
}

/** What a note's state was at-or-before a given moment (#2090) — the
 *  primitive both the unified timeline and batch point-in-time revert need.
 *  `absent`: no revision exists at or before `t` (the note didn't exist yet).
 *  `deleted`: the most recent revision at or before `t` is a delete marker.
 *  `present`: the note existed, `ts` names the revision whose content was
 *  current at that moment. */
export type AsOfState = 'absent' | 'deleted' | { kind: 'present'; ts: number };

/**
 * Resolve a note's state as of `t` from its full revision list (any order).
 * Pure — no I/O, so both the revert planner and its tests can reason about
 * it without touching disk.
 */
/**
 * Outcome of a batch point-in-time revert across a file/directory selection
 * (#2091) — a per-item outcome catalog, not a failure channel, mirroring
 * `LabelNotesResult`'s shape: the call succeeds even when individual paths
 * fail. Every target path lands in exactly one bucket (or `errors`):
 *   - `reverted` — existed both then and now; content differed, written back.
 *   - `recreated` — existed then, doesn't now (was deleted); undeleted.
 *   - `removed` — didn't exist then (or was deleted then), but exists now;
 *     deleted to match — the symmetric completion of `recreated`.
 *   - `unchanged` — the target state already matches the current state
 *     (present-and-identical, or absent-and-already-absent).
 *   - `skipped` — genuinely nothing to do: the note has no recorded history
 *     reaching back to `ts` AND doesn't exist now either.
 */
export interface BatchRevertResult {
  ts: number;
  reverted: string[];
  recreated: string[];
  removed: string[];
  unchanged: string[];
  skipped: string[];
  errors: { path: string; error: string }[];
}

export function resolveAsOf(entries: Pick<RevisionMeta, 'ts' | 'origin'>[], t: number): AsOfState {
  let latest: Pick<RevisionMeta, 'ts' | 'origin'> | null = null;
  for (const entry of entries) {
    if (entry.ts <= t && (!latest || entry.ts > latest.ts)) latest = entry;
  }
  if (!latest) return 'absent';
  if (latest.origin === 'delete') return 'deleted';
  return { kind: 'present', ts: latest.ts };
}

/** Display text for a revision's cause, with an origin-derived fallback for
 *  revisions captured before causes were recorded. */
export function describeRevisionCause(rev: Pick<RevisionMeta, 'origin' | 'cause' | 'initial'>): string {
  if (rev.cause) return rev.cause;
  if (rev.initial) return 'Initial version';
  if (rev.origin === 'restore') return 'Restored';
  if (rev.origin === 'proposal') return 'Minerva AI';
  if (rev.origin === 'delete') return 'Deleted';
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
