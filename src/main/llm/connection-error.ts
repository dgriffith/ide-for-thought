/**
 * Pure error → reason mapping for the "Check connection" flow (#...). A leaf
 * module (imports only the result type) so both the provider — which owns the
 * SDK request — and the validation entry point can share it without an import
 * cycle, and it stays unit-testable without the SDK.
 *
 * SDK errors carry an HTTP `status`; a status-less error is a connection
 * failure before we reached the service.
 *
 * **Every message names the service the caller passed in (#1804).** This file
 * used to hardcode "Anthropic" in all five strings while being called by the
 * OpenAI provider, the Google provider, AND the S3 publish target — so a bad
 * OpenAI key reported "Anthropic rejected this key", and a failed bucket check
 * reported "Couldn't reach Anthropic". Same bug as #1796, one layer down: the
 * fix is the same, make the caller say who it is.
 */
import type { ConnectionCheckResult } from '../../shared/tools/types';

export function describeConnectionFailure(err: unknown, service: string): string {
  const status = (err as { status?: number } | null)?.status;
  if (status === 401) {
    return `${service} rejected this key — it may be invalid, expired, or revoked.`;
  }
  if (status === 403) {
    return `This key authenticated but is not permitted to use ${service}.`;
  }
  if (status === 429) {
    return `Rate limited — the key works, but too many requests just now. Try again shortly.`;
  }
  if (typeof status === 'number' && status >= 500) {
    return `${service} had a server error. The key may be fine — try again shortly.`;
  }
  const detail = err instanceof Error ? err.message : String(err);
  return `Couldn't reach ${service}: ${detail}`;
}

/** Convenience wrapper: run a token-free validation request, mapping any throw
 *  to a `{ ok: false, error }`. The provider passes its SDK call in, plus the
 *  name to put in front of the user — its own, never a borrowed one. */
export async function toConnectionResult(
  request: () => Promise<unknown>,
  service: string,
): Promise<ConnectionCheckResult> {
  try {
    await request();
    return { ok: true };
  } catch (err) {
    return { ok: false, error: describeConnectionFailure(err, service) };
  }
}
