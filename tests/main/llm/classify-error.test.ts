/**
 * Provider error → failure kind (#1804).
 *
 * These are the shapes the three SDKs actually throw. The distinction the
 * tests care most about is `rate_limited` vs `quota`: both arrive as HTTP 429,
 * but one clears by itself and the other needs a credit card, and telling
 * someone to "try again shortly" when their balance is empty is precisely the
 * unhelpfulness this classifier exists to remove.
 */
import { describe, it, expect } from 'vitest';
import { classifyProviderError, toLlmFailureError } from '../../../src/main/llm/classify-error';
import { classifyLlmFailure, describeLlmFailure, missingApiKeyMessage } from '../../../src/shared/llm-errors';

/** An SDK-ish error: a real Error carrying the properties the SDKs attach. */
function apiError(props: Record<string, unknown>): Error {
  const message = typeof props.message === 'string' ? props.message : 'boom';
  return Object.assign(new Error(message), props);
}

describe('classifyProviderError', () => {
  it('maps auth failures from either status', () => {
    expect(classifyProviderError(apiError({ status: 401 }))).toBe('auth');
    expect(classifyProviderError(apiError({ status: 403 }))).toBe('auth');
  });

  it('separates a plain 429 (rate limited) from an exhausted balance (quota)', () => {
    expect(classifyProviderError(apiError({ status: 429, message: 'Too many requests' })))
      .toBe('rate_limited');
    // OpenAI's shape.
    expect(classifyProviderError(apiError({ status: 429, code: 'insufficient_quota' })))
      .toBe('quota');
  });

  it("catches Anthropic's credit-balance 400, which is not an invalid request", () => {
    const err = apiError({
      status: 400,
      message: 'Your credit balance is too low to access the Anthropic API',
    });
    expect(classifyProviderError(err)).toBe('quota');
  });

  it('treats 529 and 503 as a temporary overload, other 5xx as a server error', () => {
    expect(classifyProviderError(apiError({ status: 529 }))).toBe('overloaded');
    expect(classifyProviderError(apiError({ status: 503 }))).toBe('overloaded');
    expect(classifyProviderError(apiError({ status: 500 }))).toBe('server');
    expect(classifyProviderError(apiError({ status: 502 }))).toBe('server');
  });

  it('reads a status-less connection failure as network, never as a provider fault', () => {
    expect(classifyProviderError(apiError({ name: 'APIConnectionError' }))).toBe('network');
    expect(classifyProviderError(apiError({ message: 'getaddrinfo ENOTFOUND api.anthropic.com' })))
      .toBe('network');
    expect(classifyProviderError(apiError({ message: 'fetch failed' }))).toBe('network');
  });

  it('does not call a 500 a network error just because it mentions a timeout', () => {
    // A status means we reached the provider — the presence of "timeout" in the
    // body must not outrank that.
    expect(classifyProviderError(apiError({ status: 500, message: 'upstream timeout' })))
      .toBe('server');
  });

  it('recognises an over-long prompt as context_length, not a generic 400', () => {
    expect(classifyProviderError(apiError({ status: 400, message: 'prompt is too long: 210000 tokens' })))
      .toBe('context_length');
    expect(classifyProviderError(apiError({ status: 400, code: 'context_length_exceeded' })))
      .toBe('context_length');
  });

  it('reads an overload reported without a status', () => {
    expect(classifyProviderError(apiError({ error: { type: 'overloaded_error' } })))
      .toBe('overloaded');
  });

  it('treats an abort as a cancellation rather than a failure', () => {
    expect(classifyProviderError(apiError({ name: 'AbortError' }))).toBe('cancelled');
  });

  it("falls back to 'unknown' rather than inventing a diagnosis", () => {
    expect(classifyProviderError(apiError({ message: 'something weird' }))).toBe('unknown');
    expect(classifyProviderError(null)).toBe('unknown');
    expect(classifyProviderError(undefined)).toBe('unknown');
    expect(classifyProviderError('a bare string')).toBe('unknown');
  });
});

describe('toLlmFailureError → the renderer', () => {
  it('round-trips kind, provider and human text across an IPC-style wrap', () => {
    const wrapped = toLlmFailureError(apiError({ status: 529 }), 'anthropic');
    // What Electron hands the renderer: our message inside its own prefix.
    const overIpc = new Error(`Error invoking remote method 'conversation:send': Error: ${wrapped.message}`);

    const failure = classifyLlmFailure(overIpc);
    expect(failure?.kind).toBe('overloaded');
    expect(failure?.provider).toBe('anthropic');
    expect(failure?.retryable).toBe(true);
    expect(failure?.message).toContain('Anthropic is overloaded');
    // The machine token never reaches a user.
    expect(describeLlmFailure(overIpc)).not.toContain('MINERVA_LLM_FAILURE');
  });

  it('names the provider the user actually chose (the #1796 lesson)', () => {
    const openai = toLlmFailureError(apiError({ status: 401 }), 'openai');
    expect(classifyLlmFailure(openai)?.message).toContain('OpenAI');
    expect(classifyLlmFailure(openai)?.message).not.toContain('Anthropic');

    const google = toLlmFailureError(apiError({ status: 429, code: 'insufficient_quota' }), 'google');
    expect(classifyLlmFailure(google)?.message).toContain('Google Gemini');
  });

  it('marks only the self-clearing kinds retryable', () => {
    const retryable = ['rate_limited', 'overloaded', 'server', 'network'];
    const cases: Array<[Record<string, unknown>, string]> = [
      [{ status: 429 }, 'rate_limited'],
      [{ status: 529 }, 'overloaded'],
      [{ status: 500 }, 'server'],
      [{ name: 'APIConnectionError' }, 'network'],
      [{ status: 401 }, 'auth'],
      [{ status: 429, code: 'insufficient_quota' }, 'quota'],
      [{ status: 400, message: 'prompt is too long' }, 'context_length'],
    ];
    for (const [props, kind] of cases) {
      const failure = classifyLlmFailure(toLlmFailureError(apiError(props), 'anthropic'));
      expect(failure?.kind, kind).toBe(kind);
      expect(failure?.retryable, kind).toBe(retryable.includes(kind));
    }
  });

  it('leaves an already-classified failure alone instead of re-wrapping it', () => {
    const first = toLlmFailureError(apiError({ status: 401 }), 'openai');
    const again = toLlmFailureError(first, 'anthropic');
    // The original verdict — and the original provider — must survive.
    expect(again.message).toBe(first.message);
    expect(classifyLlmFailure(again)?.provider).toBe('openai');
  });

  it('passes the unconfigured-provider error through untouched', () => {
    // The factory throws this before any provider call; re-wrapping it would
    // destroy the marker the "Open Settings" affordance keys off.
    const unconfigured = new Error(missingApiKeyMessage('google'));
    const out = toLlmFailureError(unconfigured, 'google');
    expect(out.message).toBe(unconfigured.message);
    expect(classifyLlmFailure(out)?.kind).toBe('unconfigured');
  });
});
