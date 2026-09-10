/**
 * RFC 9207 issuer validation (#2030) — pure, no I/O. A mix-up-attack defense:
 * the client records which authorization server it expects a response FROM
 * before redirecting, then validates the callback's `iss` parameter against
 * that expectation rather than trusting whichever AS happened to answer.
 *
 * Four-row truth table:
 *   iss present, matches expected issuer         → valid
 *   iss present, does NOT match expected issuer  → invalid (always checked,
 *                                                    regardless of whether
 *                                                    the AS "supports" iss —
 *                                                    a server sending one
 *                                                    opportunistically still
 *                                                    gets validated)
 *   iss absent, AS advertises iss support         → invalid (an AS that
 *                                                    claims support but
 *                                                    omits it on this
 *                                                    response is suspicious)
 *   iss absent, AS does not advertise iss support → valid (pre-RFC-9207
 *                                                    behavior — only state
 *                                                    validation applies)
 *
 * Comparison is strict string equality, not URL-normalized — the AS's own
 * `issuer` value from its metadata document is the source of truth for
 * "expected issuer," so no independent normalization is needed or wanted.
 */

export type IssuerValidationResult = { valid: true } | { valid: false; reason: string };

export function validateIssuer(
  callbackIss: string | undefined,
  expectedIssuer: string,
  authorizationResponseIssParameterSupported: boolean,
): IssuerValidationResult {
  if (callbackIss !== undefined) {
    return callbackIss === expectedIssuer
      ? { valid: true }
      : {
          valid: false,
          reason: `iss parameter "${callbackIss}" does not match the expected issuer "${expectedIssuer}"`,
        };
  }
  if (authorizationResponseIssParameterSupported) {
    return {
      valid: false,
      reason: 'authorization server advertises iss parameter support but the callback omitted it',
    };
  }
  return { valid: true };
}
