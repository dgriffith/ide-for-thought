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
/** Pending Auto-tag suggestions to review (#940). Non-null = the AutoTagDialog is shown. */
let autoTagReview = $state<{
  relativePath: string;
  tags: string[];
} | null>(null);
/** Whether the Auto-link suggest request is currently in flight. Keeps the menu from re-triggering. */
let autoLinkBusy = $state(false);
/** Whether the Auto-tag suggest request is in flight — keeps the menu from re-triggering. */
let autoTagBusy = $state(false);

export function getRefactorFlowStore() {
  return {
    get autoLinkReview() { return autoLinkReview; },
    setAutoLinkReview(s: { relativePath: string; suggestions: AutoLinkSuggestion[]; activeBody: string } | null) { autoLinkReview = s; },
    get autoLinkInboundReview() { return autoLinkInboundReview; },
    setAutoLinkInboundReview(s: { relativePath: string; suggestions: AutoLinkInboundSuggestion[] } | null) { autoLinkInboundReview = s; },
    get autoLinkBusy() { return autoLinkBusy; },
    setAutoLinkBusy(b: boolean) { autoLinkBusy = b; },
    get autoTagReview() { return autoTagReview; },
    setAutoTagReview(s: { relativePath: string; tags: string[] } | null) { autoTagReview = s; },
    get autoTagBusy() { return autoTagBusy; },
    setAutoTagBusy(b: boolean) { autoTagBusy = b; },
  };
}
