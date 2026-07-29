/**
 * Provider factory branch (BYOM #1495).
 *
 * `getProvider(modelOverride?)` resolves the provider from the EFFECTIVE model —
 * the per-conversation override, not just the global default — so a conversation
 * pinned to an OpenAI model routes to the OpenAI implementation even when the
 * default is Claude. Missing credentials throw the marker error the renderer
 * detects to show "Open Settings".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ getSettings: vi.fn() }));
vi.mock('../../../src/main/llm/settings', () => ({ getSettings: h.getSettings }));

import { getProvider } from '../../../src/main/llm/provider';
import { MISSING_API_KEY_MARKER } from '../../../src/shared/llm-errors';

beforeEach(() => {
  vi.clearAllMocks();
  h.getSettings.mockResolvedValue({
    providers: { anthropic: { apiKey: 'sk-ant' }, openai: { apiKey: 'sk-openai' }, google: { apiKey: 'sk-gemini' } },
    model: 'claude-opus-5',
  });
});

describe('getProvider — provider resolution from the effective model', () => {
  it('uses the default model when no override is given', async () => {
    const r = await getProvider();
    expect(r.provider.id).toBe('anthropic');
    expect(r.model).toBe('claude-opus-5');
  });

  it('routes an OpenAI model override to the OpenAI provider', async () => {
    const r = await getProvider('gpt-5');
    expect(r.provider.id).toBe('openai');
    expect(r.model).toBe('gpt-5');
  });

  it('routes a Claude model override to the Anthropic provider', async () => {
    const r = await getProvider('claude-haiku-4-5');
    expect(r.provider.id).toBe('anthropic');
  });

  it('routes a Gemini model override to the Google provider', async () => {
    const r = await getProvider('gemini-2.5-pro');
    expect(r.provider.id).toBe('google');
    expect(r.model).toBe('gemini-2.5-pro');
  });

  it('falls back to Anthropic for an unknown model id', async () => {
    const r = await getProvider('some-unlisted-model');
    expect(r.provider.id).toBe('anthropic');
  });
});

describe('getProvider — local / custom models (#1497)', () => {
  it('routes a custom model to the local provider with the configured base URL', async () => {
    h.getSettings.mockResolvedValue({
      providers: { local: { baseURL: 'http://localhost:11434/v1' } },
      customModels: [{ id: 'llama3.1' }],
      model: 'claude-opus-5',
    });
    const r = await getProvider('llama3.1');
    expect(r.provider.id).toBe('local');
    expect(r.model).toBe('llama3.1');
  });

  it('throws asking for a base URL when a custom model is selected but local has none', async () => {
    h.getSettings.mockResolvedValue({ providers: {}, customModels: [{ id: 'llama3.1' }], model: 'claude-opus-5' });
    await expect(getProvider('llama3.1')).rejects.toThrow(MISSING_API_KEY_MARKER);
    await expect(getProvider('llama3.1')).rejects.toThrow(/base URL/i);
  });

  it('an unknown id that is NOT a custom model still falls back to Anthropic', async () => {
    h.getSettings.mockResolvedValue({ providers: { anthropic: { apiKey: 'sk-ant' } }, model: 'claude-opus-5' });
    const r = await getProvider('totally-unknown');
    expect(r.provider.id).toBe('anthropic');
  });
});

describe('getProvider — missing credentials', () => {
  it('throws the marker error naming OpenAI when its key is absent', async () => {
    h.getSettings.mockResolvedValue({ providers: { anthropic: { apiKey: 'sk-ant' } }, model: 'claude-opus-5' });
    await expect(getProvider('gpt-5')).rejects.toThrow(MISSING_API_KEY_MARKER);
    await expect(getProvider('gpt-5')).rejects.toThrow(/OpenAI/);
  });

  it('throws the marker error naming Gemini when its key is absent', async () => {
    h.getSettings.mockResolvedValue({ providers: { anthropic: { apiKey: 'sk-ant' } }, model: 'claude-opus-5' });
    await expect(getProvider('gemini-2.5-pro')).rejects.toThrow(MISSING_API_KEY_MARKER);
    await expect(getProvider('gemini-2.5-pro')).rejects.toThrow(/Gemini/);
  });

  it('throws the marker error naming Anthropic when its key is absent', async () => {
    h.getSettings.mockResolvedValue({ providers: {}, model: 'claude-opus-5' });
    await expect(getProvider()).rejects.toThrow(MISSING_API_KEY_MARKER);
    await expect(getProvider()).rejects.toThrow(/Anthropic/);
  });
});
