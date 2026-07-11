/**
 * Conversation property drafts (the `set_properties` tool path).
 *
 * Counterpart to `conversation-drafts.ts` and `conversation-source-drafts.ts`.
 * The LLM calls `set_properties` mid-conversation with one or more
 * `{ relativePath, properties }` entries — a shallow patch of YAML
 * frontmatter per note (null deletes a key, present values merge).
 *
 * Trust principle: the tool's server-side execution does NOT write —
 * doing so would file the change behind the user's back. It emits a
 * `ConversationPropertyDraft`, forwards it to the renderer via
 * `Channels.CONVERSATION_PROPERTY_DRAFT`, and returns "queued for
 * review." The renderer renders an inline card showing each note's
 * proposed key/value diff. Approve hands the bundle back through
 * `Channels.CONVERSATION_FILE_PROPERTY_DRAFT`; that handler reads each
 * note, applies the patch via `patchFrontmatterProperties`, and writes
 * it back atomically per file.
 *
 * Drafts live in renderer memory and are dropped when the conversation
 * tab closes — same lifecycle as note/source drafts.
 */

import type { ConversationToolDraft } from './conversation-draft-base';
import type { PropertyPatch } from './refactor/frontmatter-patch';

/** A single per-note frontmatter patch. */
export interface PropertyUpdate {
  /** Project-relative target path. The handler resolves and reads
   *  through the standard fs guard; path traversal is rejected. */
  relativePath: string;
  /** Shallow patch — keys to set or null-to-delete. Null deletes the
   *  key from frontmatter; unmentioned keys are left untouched. */
  properties: PropertyPatch;
}

export interface ConversationPropertyDraft extends ConversationToolDraft {
  updates: PropertyUpdate[];
}

/** Per-update result returned by `CONVERSATION_FILE_PROPERTY_DRAFT`. */
export interface PropertyUpdateOutcome {
  /** Echoes the entry's path so the renderer can correlate. */
  relativePath: string;
  /** Keys actually changed (set or deleted). Empty when the patch was
   *  a no-op against the current frontmatter. */
  changedKeys: string[];
  /** Keys deleted (subset of changedKeys). */
  deletedKeys: string[];
  /** Error message when the write failed for this entry. Other entries
   *  in the bundle continue independently. */
  error?: string;
}

export interface FilePropertyDraftResult {
  outcomes: PropertyUpdateOutcome[];
}

/** Input shape for the `set_properties` tool. */
export interface SetPropertiesInput {
  note: string;
  updates: PropertyUpdate[];
}
