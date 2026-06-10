/**
 * Refactor-flow feature-dialog state (#670). The two Auto-link review flows keep
 * their in-flight state here so the refactor-ops handler cluster can drive them
 * and App's template can render the paired dialogs without a prop fan-out:
 *
 * - Auto-link (outbound): suggest wiki-links for the active note, review the
 *   candidates, apply → backend rewrites the note's body.
 * - Auto-link inbound: scan other notes for places a link back to this note
 *   would fit; review + apply rewrites those source notes.
 *
 * `autoLinkBusy` guards both flows so the menu can't re-trigger a suggest
 * request while one is already in flight.
 */
import type { AutoLinkSuggestion } from '../../../shared/refactor/auto-link';
import type { AutoLinkInboundSuggestion } from '../../../shared/refactor/auto-link-inbound';

/** Pending Auto-link suggestions to review. Non-null means the AutoLinkDialog is shown. */
let autoLinkReview = $state<{
  relativePath: string;
  suggestions: AutoLinkSuggestion[];
  activeBody: string;
} | null>(null);
/** Pending Auto-link inbound suggestions to review. Non-null = dialog is shown. */
let autoLinkInboundReview = $state<{
  relativePath: string;
  suggestions: AutoLinkInboundSuggestion[];
} | null>(null);
/** Whether the Auto-link suggest request is currently in flight. Keeps the menu from re-triggering. */
let autoLinkBusy = $state(false);

export function getRefactorFlowStore() {
  return {
    get autoLinkReview() { return autoLinkReview; },
    setAutoLinkReview(s: { relativePath: string; suggestions: AutoLinkSuggestion[]; activeBody: string } | null) { autoLinkReview = s; },
    get autoLinkInboundReview() { return autoLinkInboundReview; },
    setAutoLinkInboundReview(s: { relativePath: string; suggestions: AutoLinkInboundSuggestion[] } | null) { autoLinkInboundReview = s; },
    get autoLinkBusy() { return autoLinkBusy; },
    setAutoLinkBusy(b: boolean) { autoLinkBusy = b; },
  };
}
