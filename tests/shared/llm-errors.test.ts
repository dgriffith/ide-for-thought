/**
 * The unconfigured-provider error contract (#1796 follow-up).
 *
 * The bug: the marker was hardcoded to "Anthropic API key not configured" and
 * every provider borrowed it, so picking Gemini with no Gemini key produced an
 * Anthropic-flavoured message and a dialog telling you to set
 * ANTHROPIC_API_KEY. The producer and the parser now sit in one file, and these
 * assert the round-trip for EVERY provider — which is the property that keeps
 * the two halves honest as providers are added.
 */
import { describe, it, expect } from 'vitest';
import {
  PROVIDER_UNCONFIGURED_MARKER,
  missingApiKeyMessage,
  missingBaseUrlMessage,
  isProviderUnconfiguredError,
  unconfiguredProvider,
  llmFailureMessage,
  classifyLlmFailure,
  describeLlmFailure,
  isCancellation,
  isRetryableKind,
} from '../../src/shared/llm-errors';
import { PROVIDERS, PROVIDER_IDS } from '../../src/shared/tools/providers';

describe('missing-key messages', () => {
  it('round-trips every provider: message → detected → same provider back', () => {
    for (const id of PROVIDER_IDS) {
      const msg = missingApiKeyMessage(id);
      expect(isProviderUnconfiguredError(new Error(msg)), id).toBe(true);
      expect(unconfiguredProvider(new Error(msg)), id).toBe(id);
    }
  });

  it('names the provider the user actually chose, not Anthropic', () => {
    expect(missingApiKeyMessage('google')).toContain('Google Gemini');
    expect(missingApiKeyMessage('google')).not.toContain('Anthropic');
    expect(missingApiKeyMessage('openai')).not.toContain('ANTHROPIC_API_KEY');
  });

  it('names each provider’s own environment variable, and omits it when there is none', () => {
    for (const id of PROVIDER_IDS) {
      const msg = missingApiKeyMessage(id);
      const env = PROVIDERS[id].envVar;
      if (env) expect(msg, id).toContain(env);
      else expect(msg, id).not.toMatch(/set [A-Z_]+\./);
    }
  });

  it('says base URL, not API key, for the provider that needs an address', () => {
    // The local / OpenAI-compatible endpoint reports through the same channel,
    // so the same "open Settings" affordance fires — but telling someone to add
    // an API key when the problem is a missing address sends them nowhere.
    const msg = missingBaseUrlMessage('local');
    expect(msg).toContain('base URL');
    expect(msg).not.toContain('API key');
    expect(unconfiguredProvider(new Error(msg))).toBe('local');
  });
});

describe('detection across the IPC boundary', () => {
  it('survives Electron’s "Error invoking remote method" prefix', () => {
    const wrapped = new Error(
      `Error invoking remote method 'conversation:send': Error: ${missingApiKeyMessage('openai')}`,
    );
    expect(isProviderUnconfiguredError(wrapped)).toBe(true);
    expect(unconfiguredProvider(wrapped)).toBe('openai');
  });

  it('accepts a bare string, since IPC sometimes hands one over', () => {
    expect(isProviderUnconfiguredError(missingApiKeyMessage('anthropic'))).toBe(true);
  });

  it('ignores anything else', () => {
    for (const other of [null, undefined, 42, new Error('rate limited'), 'network down']) {
      expect(isProviderUnconfiguredError(other), String(other)).toBe(false);
      expect(unconfiguredProvider(other), String(other)).toBeNull();
    }
  });

  it('returns null rather than guessing when the provider is not named', () => {
    // Only reachable if something builds a message by hand. The caller's
    // fallback is generic copy — guessing a provider is the original bug.
    const vague = new Error(`Something ${PROVIDER_UNCONFIGURED_MARKER}.`);
    expect(isProviderUnconfiguredError(vague)).toBe(true);
    expect(unconfiguredProvider(vague)).toBeNull();
  });
});

// ── The general failure taxonomy (#1804) ────────────────────────────────────
// Same round-trip property as above, one layer up: main builds a message,
// the renderer parses it back. IPC strips an SDK error's `status`, so text is
// the only channel — which makes these assertions the contract.

describe('llmFailureMessage → classifyLlmFailure', () => {
  it('round-trips kind, provider and human text', () => {
    const wire = llmFailureMessage('rate_limited', 'Anthropic is rate limiting this key.', 'anthropic');
    const failure = classifyLlmFailure(new Error(wire));
    expect(failure?.kind).toBe('rate_limited');
    expect(failure?.provider).toBe('anthropic');
    expect(failure?.message).toBe('Anthropic is rate limiting this key.');
  });

  it('survives Electron’s wrapper, the same way the unconfigured marker does', () => {
    const wire = llmFailureMessage('overloaded', 'Overloaded.', 'google');
    const wrapped = new Error(`Error invoking remote method 'conversation:send': Error: ${wire}`);
    expect(classifyLlmFailure(wrapped)?.kind).toBe('overloaded');
    expect(classifyLlmFailure(wrapped)?.message).toBe('Overloaded.');
  });

  it('never leaks the machine token into user-facing text', () => {
    const wire = llmFailureMessage('server', 'Server error.', 'openai');
    expect(describeLlmFailure(new Error(wire))).toBe('Server error.');
    expect(describeLlmFailure(new Error(wire))).not.toContain('MINERVA_LLM_FAILURE');
  });

  it('carries a provider-less failure without inventing one', () => {
    const failure = classifyLlmFailure(new Error(llmFailureMessage('network', 'Offline.')));
    expect(failure?.provider).toBeNull();
    expect(failure?.kind).toBe('network');
  });

  it('classifies a legacy unconfigured message that predates the token', () => {
    const failure = classifyLlmFailure(new Error(missingApiKeyMessage('google')));
    expect(failure?.kind).toBe('unconfigured');
    expect(failure?.provider).toBe('google');
    expect(failure?.retryable).toBe(false);
  });

  it('returns null for anything that is not ours, rather than guessing a kind', () => {
    expect(classifyLlmFailure(new Error('something odd'))).toBeNull();
    expect(classifyLlmFailure(null)).toBeNull();
    expect(classifyLlmFailure(42)).toBeNull();
  });

  it('still says something useful for an unrecognised error', () => {
    // The fallback path: strip Electron's prefix, show the rest. Anything is
    // better than the console.error this replaced.
    const raw = new Error("Error invoking remote method 'conversation:send': Error: disk on fire");
    expect(describeLlmFailure(raw)).toBe('disk on fire');
    expect(describeLlmFailure(null)).toBe('Something went wrong.');
  });

  it('marks exactly the self-clearing kinds retryable', () => {
    for (const kind of ['rate_limited', 'overloaded', 'server', 'network'] as const) {
      expect(isRetryableKind(kind), kind).toBe(true);
    }
    for (const kind of ['auth', 'quota', 'unconfigured', 'context_length', 'invalid_request', 'cancelled', 'unknown'] as const) {
      expect(isRetryableKind(kind), kind).toBe(false);
    }
  });
});

describe('isCancellation', () => {
  it('recognises an AbortError from AbortController', () => {
    expect(isCancellation(Object.assign(new Error('aborted'), { name: 'AbortError' }))).toBe(true);
  });

  it('recognises a cancellation that crossed IPC', () => {
    expect(isCancellation(new Error(llmFailureMessage('cancelled', 'Cancelled.')))).toBe(true);
  });

  it('does NOT match a provider error that merely contains the word "abort"', () => {
    // The bug this replaces: `String(e).includes('abort')` swallowed real
    // failures whose message happened to mention an abort.
    const real = new Error(llmFailureMessage('server', 'The request was aborted upstream.', 'anthropic'));
    expect(isCancellation(real)).toBe(false);
  });
});
