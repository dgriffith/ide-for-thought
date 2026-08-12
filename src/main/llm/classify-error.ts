/**
 * Provider error → `LlmFailureKind`, in the one place the SDK error is still
 * intact (#1804).
 *
 * Electron's IPC strips the Error class and every custom property, so an SDK
 * error's `status` / `code` / body cannot reach the renderer. Classify here,
 * in main, and let `shared/llm-errors.ts` carry the verdict across as text.
 *
 * Deliberately status-first with per-provider refinements layered on top:
 * HTTP status is the one thing all three SDKs agree on, and it degrades
 * sensibly for the `local` provider (Ollama / LM Studio / vLLM / OpenRouter),
 * whose error bodies we can't enumerate. The refinements only ever make a
 * verdict *more* specific — they never rescue an unrecognised error into a
 * confident-sounding lie, because "we don't know" (`unknown`, which renders
 * the provider's own text) is more useful than a wrong diagnosis.
 *
 * The distinction that matters most to a user is `rate_limited` vs `quota`:
 * both commonly arrive as 429, but one clears on its own in a minute and the
 * other needs a credit card. Telling someone to "try again shortly" when their
 * balance is empty is exactly the unhelpfulness this file exists to remove.
 */
import {
  llmFailureMessage,
  type LlmFailureKind,
} from '../../shared/llm-errors';
import { PROVIDERS, type ProviderId } from '../../shared/tools/providers';

interface ErrorShape {
  status?: number;
  /** OpenAI puts a machine code here; Anthropic nests a type in the body. */
  code?: string;
  type?: string;
  message?: string;
  name?: string;
  error?: { type?: string; message?: string; error?: { type?: string; message?: string } };
}

function shapeOf(err: unknown): ErrorShape {
  // Every field is optional, so a plain `object` already satisfies ErrorShape —
  // no assertion needed, and none wanted: this must stay honest about the fact
  // that we're probing an error whose shape we don't control.
  if (typeof err !== 'object' || err === null) return {};
  return err;
}

/** Every scrap of provider-supplied text, lowercased, for substring probes. */
function haystack(e: ErrorShape): string {
  return [
    e.message,
    e.code,
    e.type,
    e.error?.type,
    e.error?.message,
    e.error?.error?.type,
    e.error?.error?.message,
  ]
    .filter((s): s is string => typeof s === 'string')
    .join(' ')
    .toLowerCase();
}

/**
 * Billing exhaustion, across providers:
 *   Anthropic — HTTP 400, "Your credit balance is too low to access the API"
 *   OpenAI    — HTTP 429, code `insufficient_quota`
 *   Google    — RESOURCE_EXHAUSTED with a billing/quota body
 * A plain 429 with none of these is ordinary rate limiting.
 */
function looksLikeQuota(text: string): boolean {
  return (
    text.includes('insufficient_quota')
    || text.includes('credit balance')
    || text.includes('billing')
    || text.includes('exceeded your current quota')
    || text.includes('quota exceeded')
    || text.includes('payment')
  );
}

function looksLikeContextLength(text: string): boolean {
  return (
    text.includes('context_length_exceeded')
    || text.includes('context window')
    || text.includes('prompt is too long')
    || text.includes('maximum context length')
    || text.includes('too many tokens')
  );
}

/** No HTTP status at all ⇒ we never got an answer from the provider. */
function looksLikeNetwork(e: ErrorShape, text: string): boolean {
  if (typeof e.status === 'number') return false;
  return (
    e.name === 'APIConnectionError'
    || e.name === 'APIConnectionTimeoutError'
    || e.name === 'FetchError'
    || /\b(enotfound|econnrefused|econnreset|etimedout|eai_again|epipe|certificate|self[- ]signed|socket hang up|network|fetch failed|timeout)\b/.test(text)
  );
}

/** Classify without formatting — exported for tests and for reuse. */
export function classifyProviderError(err: unknown): LlmFailureKind {
  const e = shapeOf(err);
  if (e.name === 'AbortError' || e.name === 'TimeoutError') return 'cancelled';

  const text = haystack(e);
  const status = e.status;

  if (looksLikeNetwork(e, text)) return 'network';

  if (status === 401) return 'auth';
  if (status === 403) return 'auth';
  if (status === 429) return looksLikeQuota(text) ? 'quota' : 'rate_limited';
  // Anthropic's bespoke overload status, plus the standard unavailable pair.
  if (status === 529 || status === 503) return 'overloaded';
  if (typeof status === 'number' && status >= 500) return 'server';
  if (status === 400 || status === 404 || status === 413 || status === 422) {
    if (looksLikeQuota(text)) return 'quota';
    if (looksLikeContextLength(text)) return 'context_length';
    return 'invalid_request';
  }

  // Status-less but clearly one of these — some SDKs surface an overload or a
  // rate limit as a typed error before an HTTP status is attached.
  if (text.includes('overloaded')) return 'overloaded';
  if (looksLikeQuota(text)) return 'quota';
  if (looksLikeContextLength(text)) return 'context_length';

  return 'unknown';
}

/**
 * The user-facing half. Names the provider the user actually chose — the
 * lesson of #1796, where every provider borrowed Anthropic's copy.
 */
function describe(kind: LlmFailureKind, label: string, e: ErrorShape): string {
  const detail = typeof e.message === 'string' && e.message.trim() ? e.message.trim() : '';
  switch (kind) {
    case 'auth':
      return `${label} rejected this API key — it may be invalid, expired, or revoked. Check it in Settings → AI.`;
    case 'rate_limited':
      return `${label} is rate limiting this key — too many requests just now. This usually clears in a minute.`;
    case 'quota':
      return `Your ${label} account is out of credit or has hit its quota. Retrying won't help until billing is topped up.`;
    case 'overloaded':
      return `${label} is overloaded right now. This is temporary and not a problem with your setup.`;
    case 'server':
      return `${label} had a server error${typeof e.status === 'number' ? ` (${e.status})` : ''}. Nothing wrong on your side — try again shortly.`;
    case 'network':
      return `Couldn't reach ${label}. Check your internet connection${detail ? ` (${detail})` : ''}.`;
    case 'context_length':
      return `This conversation is too long for the model's context window. Run /compact to summarise earlier turns, or start a fresh conversation.`;
    case 'invalid_request':
      return `${label} rejected the request${detail ? `: ${detail}` : '.'}`;
    case 'cancelled':
      return 'Cancelled.';
    default:
      return detail || `${label} returned an unexpected error.`;
  }
}

/**
 * Wrap a provider error as the marker-carrying Error main throws. A failure we
 * already classified (a nested rethrow, or the unconfigured error the factory
 * raises) passes through untouched so the original verdict wins.
 */
export function toLlmFailureError(err: unknown, providerId: ProviderId | null): Error {
  const msg = err instanceof Error ? err.message : typeof err === 'string' ? err : '';
  if (msg.includes('MINERVA_LLM_FAILURE:') || msg.includes('is not set up yet')) {
    return err instanceof Error ? err : new Error(msg);
  }
  const kind = classifyProviderError(err);
  const label = providerId ? PROVIDERS[providerId].label : 'The model provider';
  const wrapped = new Error(
    llmFailureMessage(kind, describe(kind, label, shapeOf(err)), providerId),
  );
  // Keep the original for main-side logging; it does not cross IPC.
  wrapped.cause = err;
  return wrapped;
}
