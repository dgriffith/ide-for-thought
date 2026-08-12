/**
 * The "this provider isn't set up" error contract, shared by the process that
 * throws it and the one that reacts to it.
 *
 * IPC strips the Error class, so message-matching is what we have: main throws
 * a message containing `PROVIDER_UNCONFIGURED_MARKER`, and the renderer detects
 * it across the boundary (Electron's `invoke` rejects with a plain Error whose
 * `.message` carries the main-process text, prefixed with "Error invoking
 * remote method '…': ", so the marker survives as a substring).
 *
 * The message BUILDERS live here beside the parser on purpose (#1796
 * follow-up). The marker used to be hardcoded to "Anthropic API key not
 * configured" and every provider borrowed it, so choosing a Gemini model with
 * no Gemini key produced "Anthropic API key not configured. Set the Google
 * Gemini API key…" — and the renderer's dialog, having no way to know better,
 * told you to set ANTHROPIC_API_KEY. Keeping both halves in one file is what
 * makes the round-trip testable.
 *
 * "Unconfigured" rather than "missing key" because the local /
 * OpenAI-compatible provider needs a base URL, not a key, and reports through
 * the same channel — a message about an API key would be wrong for it.
 */

import { PROVIDERS, PROVIDER_IDS, type ProviderId } from './tools/providers';

/** Stable substring identifying an unconfigured-provider failure. Neutral: the
 *  provider is named around it, never inside it. */
export const PROVIDER_UNCONFIGURED_MARKER = 'is not set up yet';

function messageOf(err: unknown): string | null {
  if (err == null) return null;
  if (err instanceof Error) return err.message;
  if (typeof err === 'string') return err;
  return null;
}

/* ── The general failure taxonomy (#1804) ──────────────────────────────────
 *
 * "Provider isn't set up" was the only failure the UI could recognise, because
 * it was the only one anybody encoded. Everything else — a revoked key, a 429,
 * an exhausted credit balance, a 529 overload, an unplugged network cable —
 * arrived as an opaque SDK error, got `console.error`d in the renderer, and
 * left the user staring at an un-replied turn.
 *
 * IPC strips the Error class and every custom property, so an SDK error's
 * `status` does NOT survive the boundary. Classification therefore has to
 * happen in MAIN, where the SDK error is still intact, and travel as text. This
 * extends the marker trick above to the whole taxonomy: main builds the message
 * with `llmFailureMessage`, which embeds a machine token; the renderer parses
 * it back with `classifyLlmFailure` and renders the human half.
 *
 * The token is stripped from anything user-visible — `describeLlmFailure` is
 * the only thing UI should print.
 */

/** What went wrong, in terms a UI can act on. */
export type LlmFailureKind =
  /** No key / no base URL. Actionable: open Settings → AI. */
  | 'unconfigured'
  /** Key rejected, expired, revoked, or not permitted (401/403). */
  | 'auth'
  /** Too many requests (429). Temporary; retry works. */
  | 'rate_limited'
  /** Credit balance or plan quota exhausted. Retrying will NOT help. */
  | 'quota'
  /** Provider overloaded (429-overloaded / 503 / Anthropic 529). Temporary. */
  | 'overloaded'
  /** Provider-side 5xx. Temporary. */
  | 'server'
  /** Never reached the provider — offline, DNS, TLS, timeout. */
  | 'network'
  /** The request exceeded the model's context window. */
  | 'context_length'
  /** The provider refused the request as malformed / not permitted (4xx). */
  | 'invalid_request'
  /** The user cancelled. Not an error; the UI should stay quiet. */
  | 'cancelled'
  /** Anything unrecognised. */
  | 'unknown';

/** A parsed failure, ready to render. */
export interface LlmFailure {
  kind: LlmFailureKind;
  /** Human-readable, already provider-specific. Never contains the token. */
  message: string;
  /** Which provider failed, when the classifier knew. */
  provider: ProviderId | null;
  /** Is trying the exact same request again worth offering? */
  retryable: boolean;
}

/** Kinds where the same request may well succeed on a second attempt. */
const RETRYABLE: ReadonlySet<LlmFailureKind> = new Set<LlmFailureKind>([
  'rate_limited', 'overloaded', 'server', 'network',
]);

export function isRetryableKind(kind: LlmFailureKind): boolean {
  return RETRYABLE.has(kind);
}

/**
 * The machine half of the contract. Searched for anywhere in the message rather
 * than anchored, because Electron wraps it ("Error invoking remote method '…':
 * Error: <ours>") and a provider SDK may wrap it again.
 */
const TOKEN_RE = /MINERVA_LLM_FAILURE:([a-z_]+):([a-z]*):/;

/** Build the wire message main throws. `detail` is the human half. */
export function llmFailureMessage(
  kind: LlmFailureKind,
  detail: string,
  provider: ProviderId | null = null,
): string {
  return `MINERVA_LLM_FAILURE:${kind}:${provider ?? ''}:${detail}`;
}

/**
 * Parse a failure back out of whatever crossed the boundary.
 *
 * Returns null when this isn't one of ours — callers should NOT invent a kind
 * for an arbitrary error, the same way `unconfiguredProvider` returns null
 * rather than guessing a provider.
 */
export function classifyLlmFailure(err: unknown): LlmFailure | null {
  const msg = messageOf(err);
  if (msg === null) return null;

  const m = TOKEN_RE.exec(msg);
  if (m) {
    const kind = m[1] as LlmFailureKind;
    const provider = (m[2] || null) as ProviderId | null;
    return {
      kind,
      message: msg.slice(m.index + m[0].length).trim(),
      provider,
      retryable: isRetryableKind(kind),
    };
  }

  // Legacy / hand-built unconfigured messages predate the token (and the
  // builders below still emit the human marker for them), so keep detecting
  // those the original way rather than dropping them to 'unknown'.
  if (isProviderUnconfiguredError(err)) {
    return {
      kind: 'unconfigured',
      message: stripIpcPrefix(msg),
      provider: unconfiguredProvider(err),
      retryable: false,
    };
  }

  // A user cancel comes back as a DOMException/AbortError, not as one of ours.
  if (isAbortError(err)) {
    return { kind: 'cancelled', message: 'Cancelled.', provider: null, retryable: false };
  }

  return null;
}

/**
 * One-line, user-facing text for any error at all — the only thing UI should
 * print. Unrecognised errors fall through to their own message, minus the
 * Electron IPC prefix, so a genuinely novel failure still says *something*
 * instead of vanishing into console.error.
 */
export function describeLlmFailure(err: unknown): string {
  const failure = classifyLlmFailure(err);
  if (failure) return failure.message;
  const msg = messageOf(err);
  return msg === null ? 'Something went wrong.' : stripIpcPrefix(msg);
}

/**
 * Was this a user-initiated cancel rather than a failure?
 *
 * Replaces `String(e).includes('abort')` in the conversation store, which both
 * over-matched (any provider error mentioning "abort") and under-matched (a
 * cancel worded any other way). `AbortController` produces a DOMException named
 * `AbortError`; the classified form covers a cancel that crossed IPC.
 */
export function isCancellation(err: unknown): boolean {
  return isAbortError(err) || classifyLlmFailure(err)?.kind === 'cancelled';
}

function isAbortError(err: unknown): boolean {
  const name = (err as { name?: unknown } | null)?.name;
  return name === 'AbortError' || name === 'TimeoutError';
}

/** Electron prefixes a rejected handler's message; it's noise in the UI. */
function stripIpcPrefix(msg: string): string {
  return msg
    .replace(/^Error invoking remote method '[^']*':\s*/, '')
    .replace(/^(?:Error|DOMException):\s*/, '')
    .trim();
}

function prefix(id: ProviderId): string {
  return `${PROVIDERS[id].label} ${PROVIDER_UNCONFIGURED_MARKER}`;
}

/** "This provider has no API key." Names the provider and its env var. */
export function missingApiKeyMessage(id: ProviderId): string {
  const env = PROVIDERS[id].envVar ? ` or set ${PROVIDERS[id].envVar}` : '';
  return `${prefix(id)}. Add an API key in Settings → AI${env}.`;
}

/** "This provider has no endpoint." The local provider's equivalent. */
export function missingBaseUrlMessage(id: ProviderId): string {
  return `${prefix(id)}. Add a base URL in Settings → AI.`;
}

/** Did this failure come from a provider that isn't set up? */
export function isProviderUnconfiguredError(err: unknown): boolean {
  const msg = messageOf(err);
  return msg !== null && msg.includes(PROVIDER_UNCONFIGURED_MARKER);
}

/**
 * Which provider isn't set up, or null when the error isn't one of ours.
 * Callers should treat null as "say something generic" rather than guessing a
 * provider — guessing is the bug this replaced.
 */
export function unconfiguredProvider(err: unknown): ProviderId | null {
  const msg = messageOf(err);
  if (msg === null) return null;
  return PROVIDER_IDS.find((id) => msg.includes(prefix(id))) ?? null;
}
