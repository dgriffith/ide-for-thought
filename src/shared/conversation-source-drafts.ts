/**
 * Conversation source drafts (the `propose_sources` tool path).
 *
 * Counterpart to `conversation-drafts.ts`. The LLM, mid-conversation, can
 * call the `propose_sources` tool with one or more `{ identifier? | url? }`
 * entries to suggest sources the user might want to ingest. The tool's
 * server-side execution does NOT call the ingest pipeline — that would
 * touch disk and the graph behind the user's back. Instead it emits a
 * `ConversationSourceDraft`, forwards it to the renderer via
 * `Channels.CONVERSATION_SOURCE_DRAFT`, and returns to the model: "queued
 * for review."
 *
 * The renderer renders each draft as an inline card under the assistant
 * message — URL/identifier list + the LLM's bundle-level "why I'm
 * proposing this" note + Approve/Discard. When the user clicks Approve,
 * the renderer hands the bundle back through
 * `Channels.CONVERSATION_FILE_SOURCE_DRAFT`; the main-process handler
 * loops over the entries and runs the existing `ingestUrl` /
 * `ingestIdentifier` pipelines per source — so the LLM-driven path
 * reuses every piece of the manual "Ingest URL…" / "Ingest Identifier…"
 * flow, including Readability extraction, site-handler enrichment,
 * Crossref/arXiv/PubMed lookup, and duplicate detection.
 *
 * Like ConversationDraft, these live in renderer memory and are dropped
 * when the conversation tab closes. Persistence is a follow-up.
 */

import type { ConversationToolDraft } from './conversation-draft-base';

/**
 * One proposed source. Exactly one of `identifier` / `url` is present;
 * the tool validates that constraint server-side before emitting the
 * draft.
 */
export interface DraftSource {
  /** DOI / arXiv id / PubMed id — anything `detectIdentifier()` accepts. */
  identifier?: string;
  /** Web URL — anything `normalizeUrl()` accepts (http(s) only). */
  url?: string;
}

export interface ConversationSourceDraft extends ConversationToolDraft {
  sources: DraftSource[];
}

/** Per-source result returned by `CONVERSATION_FILE_SOURCE_DRAFT`. */
export interface SourceIngestOutcome {
  /** Echoes the entry from the draft so the renderer can correlate. */
  input: DraftSource;
  /** Set when ingest succeeded (or the source already existed). */
  sourceId?: string;
  /** Source title (from Readability / site handler / metadata API). */
  title?: string;
  /** True when an existing source matched — nothing was overwritten. */
  duplicate?: boolean;
  /** Error message when ingest failed for this entry. Other entries
   *  in the bundle continue independently. */
  error?: string;
}

export interface FileSourceDraftResult {
  outcomes: SourceIngestOutcome[];
}

/** Input shape for the `propose_sources` tool. */
export interface ProposeSourcesInput {
  note: string;
  sources: DraftSource[];
}
