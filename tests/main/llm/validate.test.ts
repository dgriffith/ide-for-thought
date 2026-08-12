/**
 * Active API-key validation for the settings "Check connection" button (#...).
 * `checkConnection` resolves the effective key (typed beats stored) and delegates
 * the request to the provider (mocked here — the SDK stays behind the #1148
 * seam). `describeConnectionFailure` is the pure error → reason mapper.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  providerCheck: vi.fn(),
  createProviderForKey: vi.fn(),
  getSettings: vi.fn(),
}));

vi.mock('../../../src/main/llm/provider', () => ({ createProviderForKey: h.createProviderForKey }));
vi.mock('../../../src/main/llm/settings', () => ({ getSettings: h.getSettings }));

import { checkConnection } from '../../../src/main/llm/validate';
import { describeConnectionFailure } from '../../../src/main/llm/connection-error';

beforeEach(() => {
  vi.clearAllMocks();
  h.getSettings.mockResolvedValue({ providers: { anthropic: { apiKey: 'sk-stored' } } });
  h.providerCheck.mockResolvedValue({ ok: true });
  h.createProviderForKey.mockReturnValue({ checkConnection: h.providerCheck });
});

describe('checkConnection — credential resolution', () => {
  it('validates a typed key (trimmed), preferring it over the stored one', async () => {
    const res = await checkConnection('anthropic', '  sk-typed  ');
    expect(res).toEqual({ ok: true });
    expect(h.createProviderForKey).toHaveBeenCalledWith('anthropic', 'sk-typed', undefined);
  });

  it('falls back to the stored key for the provider when no candidate is given', async () => {
    await checkConnection('anthropic', '');
    expect(h.getSettings).toHaveBeenCalled();
    expect(h.createProviderForKey).toHaveBeenCalledWith('anthropic', 'sk-stored', undefined);
  });

  it('short-circuits with no provider call when a keyed provider has no key', async () => {
    h.getSettings.mockResolvedValue({ providers: { anthropic: { apiKey: '' } } });
    const res = await checkConnection('anthropic', undefined);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No API key/i);
    expect(h.createProviderForKey).not.toHaveBeenCalled();
  });

  it('resolves the requested provider (openai) from settings', async () => {
    h.getSettings.mockResolvedValue({ providers: { openai: { apiKey: 'sk-openai' } } });
    await checkConnection('openai');
    expect(h.createProviderForKey).toHaveBeenCalledWith('openai', 'sk-openai', undefined);
  });

  it('checks a keyless local endpoint by base URL (typed beats stored)', async () => {
    h.getSettings.mockResolvedValue({ providers: { local: { baseURL: 'http://stored/v1' } } });
    await checkConnection('local', '', 'http://typed:11434/v1');
    expect(h.createProviderForKey).toHaveBeenCalledWith('local', '', 'http://typed:11434/v1');
  });

  it('errors when a local endpoint has no base URL', async () => {
    h.getSettings.mockResolvedValue({ providers: {} });
    const res = await checkConnection('local');
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/base URL/i);
    expect(h.createProviderForKey).not.toHaveBeenCalled();
  });

  it('passes the provider result straight through', async () => {
    h.providerCheck.mockResolvedValue({ ok: false, error: 'provider rejected this key' });
    const res = await checkConnection('anthropic', 'sk-bad');
    expect(res).toEqual({ ok: false, error: 'provider rejected this key' });
  });
});

describe('describeConnectionFailure — reason mapping', () => {
  const withStatus = (status: number) => Object.assign(new Error('x'), { status });

  it('401 → invalid / expired / revoked', () => {
    expect(describeConnectionFailure(withStatus(401), 'Anthropic')).toMatch(/invalid, expired, or revoked/i);
  });
  it('403 → not permitted', () => {
    expect(describeConnectionFailure(withStatus(403), 'Anthropic')).toMatch(/not permitted/i);
  });
  it('429 → rate limited (key still works)', () => {
    expect(describeConnectionFailure(withStatus(429), 'Anthropic')).toMatch(/rate limited/i);
  });
  it('5xx → server error', () => {
    expect(describeConnectionFailure(withStatus(503), 'Anthropic')).toMatch(/server error/i);
  });
  it('status-less error → connection failure with the detail', () => {
    const msg = describeConnectionFailure(new Error('ECONNREFUSED'), 'Anthropic');
    expect(msg).toMatch(/couldn't reach anthropic/i);
    expect(msg).toContain('ECONNREFUSED');
  });

  // The bug (#1804): every string here hardcoded "Anthropic", while the OpenAI
  // provider, the Google provider and the S3 publish target all call through
  // this same helper. A bad OpenAI key reported "Anthropic rejected this key";
  // a failed bucket check reported "Couldn't reach Anthropic". Same shape as
  // #1796, one layer down.
  it('names the service the caller passed, never a borrowed one', () => {
    for (const [status, service] of [[401, 'OpenAI'], [403, 'Google Gemini'], [503, 'S3']] as const) {
      const msg = describeConnectionFailure(withStatus(status), service);
      expect(msg, service).toContain(service);
      expect(msg, service).not.toContain('Anthropic');
    }
    const s3 = describeConnectionFailure(new Error('ENOTFOUND'), 'S3');
    expect(s3).toMatch(/couldn't reach s3/i);
    expect(s3).not.toContain('Anthropic');
  });
});
