/**
 * Helper carried over from the original one-shot Find Supporting /
 * Opposing Arguments tool (#409 / #410). The conversational rework
 * uses a registered tool def + the existing `propose_notes` flow, so
 * the prompt builders / JSON parser / orchestrator are gone — but
 * `extractClaimUri` is still used by the editor's right-click context
 * menu to gate the conversational tools on the cursor sitting on a
 * claim line.
 */

/**
 * Find a thought:Claim URI in `text`. The pattern matches Minerva's
 * canonical claim URI shape (`https://minerva.dev/c/claim-…`) — the
 * decompose-claims tool mints these and the user's notes typically
 * contain a bare URI for each claim. Returns null when nothing matches;
 * note that finding the URI doesn't prove the URI actually resolves to
 * a thought:Claim in the graph (callers may still need to verify).
 */
export function extractClaimUri(text: string): string | null {
  const re = /<?(https?:\/\/[^\s<>"]*\/c\/claim-[^\s<>"]+)>?/i;
  const m = re.exec(text);
  return m ? m[1] : null;
}
