/**
 * Drafted-extension cards waiting on the user (#2652), keyed by offer id.
 *
 * The conversation's stream callbacks put one here when
 * `offer_extension_draft` runs (`conversation-stream.ts`), and the action
 * handler (`register-plugins.ts`) takes it out when the user chooses. The
 * entry holds the CHECKED draft: what main writes on Save is this copy, never
 * anything the renderer sends, so the card can only act on what the tool
 * checked and showed.
 *
 * Like the MCP confirm card, an entry never rejects: Save, Save to folder,
 * Not now, a stopped turn and a closed window all RESOLVE it, and `settle` is
 * idempotent and removes the entry and its listeners.
 */
import type { ExtensionDraftOutcome } from '../../shared/extensions/drafts';
import type { CheckedExtensionDraft } from '../extensions/draft-check';

export interface PendingExtensionDraft {
  winId: number;
  draft: CheckedExtensionDraft;
  settle: (outcome: ExtensionDraftOutcome) => void;
}

export const pendingExtensionDrafts = new Map<string, PendingExtensionDraft>();
