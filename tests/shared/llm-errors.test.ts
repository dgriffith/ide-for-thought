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
