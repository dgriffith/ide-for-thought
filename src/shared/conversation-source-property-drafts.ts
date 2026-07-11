/**
 * Conversation source-property drafts (the `propose_source_properties` tool
 * path, #103).
 *
 * Counterpart to `conversation-property-drafts.ts`, but the target is a Source's
 * `meta.ttl` rather than a note's frontmatter. The LLM, summarizing a source,
 * calls `propose_source_properties` with a proposed `dc:abstract` and/or
 * `thought:tldr` for one source.
 *
 * Trust principle: the tool's server-side execution does NOT write — it emits a
 * `ConversationSourcePropertyDraft`, forwards it to the renderer via
 * `Channels.CONVERSATION_SOURCE_PROPERTY_DRAFT`, and returns "queued for
 * review." The renderer renders an inline card with the proposed abstract /
 * TL;DR. Approve hands the bundle back through
 * `Channels.CONVERSATION_FILE_SOURCE_PROPERTY_DRAFT`; that handler upserts the
 * predicates into the source's meta.ttl (`setSourceProperties`) and reindexes.
 *
 * Drafts live in renderer memory and are dropped when the conversation tab
 * closes — same lifecycle as note / source / property drafts.
 */

import type { ConversationToolDraft } from './conversation-draft-base';

export interface ConversationSourcePropertyDraft extends ConversationToolDraft {
  /** The source whose meta.ttl is being patched. */
  sourceId: string;
  /** Proposed formal abstract (`dc:abstract`). Omitted when not proposed. */
  abstract?: string;
  /** Proposed one-paragraph plain-language summary (`thought:tldr`). */
  tldr?: string;
}

/** Per-predicate result returned by `CONVERSATION_FILE_SOURCE_PROPERTY_DRAFT`. */
export interface SourcePropertyOutcome {
  sourceId: string;
  /** Predicates actually changed (e.g. `dc:abstract`, `thought:tldr`). Empty
   *  when every proposed value already matched what was on the source. */
  changedPredicates: string[];
  /** Error message when the write failed; the card surfaces it. */
  error?: string;
}

export interface FileSourcePropertyDraftResult {
  outcome: SourcePropertyOutcome;
}

/** Input shape for the `propose_source_properties` tool. */
export interface ProposeSourcePropertiesInput {
  note: string;
  sourceId: string;
  abstract?: string;
  tldr?: string;
}
