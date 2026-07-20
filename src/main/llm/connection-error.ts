/**
 * Pure error → reason mapping for the "Check connection" flow (#...). A leaf
 * module (imports only the result type) so both the provider — which owns the
 * SDK request — and the validation entry point can share it without an import
 * cycle, and it stays unit-testable without the SDK.
 *
 * Anthropic SDK errors carry an HTTP `status`; a status-less error is a
 * connection failure before we reached the API.
 */
import type { ConnectionCheckResult } from '../../shared/tools/types';

export function describeConnectionFailure(err: unknown): string {
  const status = (err as { status?: number } | null)?.status;
  if (status === 401) {
    return 'Anthropic rejected this key — it may be invalid, expired, or revoked.';
  }
  if (status === 403) {
    return 'This key authenticated but is not permitted to use the API.';
  }
  if (status === 429) {
    return 'Rate limited — the key works, but too many requests just now. Try again shortly.';
  }
  if (typeof status === 'number' && status >= 500) {
    return 'Anthropic had a server error. The key may be fine — try again shortly.';
  }
  const detail = err instanceof Error ? err.message : String(err);
  return `Couldn't reach Anthropic: ${detail}`;
}

/** Convenience wrapper: run a token-free validation request, mapping any throw
 *  to a `{ ok: false, error }`. The provider passes its SDK call in. */
export async function toConnectionResult(request: () => Promise<unknown>): Promise<ConnectionCheckResult> {
  try {
    await request();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describeConnectionFailure(err) };
  }
}
