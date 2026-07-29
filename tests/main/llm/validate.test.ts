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

describe('checkConnection — key resolution', () => {
  it('validates a typed key (trimmed) without touching stored settings', async () => {
    const res = await checkConnection('  sk-typed  ');
    expect(res).toEqual({ ok: true });
    expect(h.getSettings).not.toHaveBeenCalled();
    expect(h.createProviderForKey).toHaveBeenCalledWith('sk-typed');
  });

  it('falls back to the stored key when no candidate is given', async () => {
    await checkConnection('');
    expect(h.getSettings).toHaveBeenCalled();
    expect(h.createProviderForKey).toHaveBeenCalledWith('sk-stored');
  });

  it('short-circuits with no provider call when there is no key at all', async () => {
    h.getSettings.mockResolvedValue({ providers: { anthropic: { apiKey: '' } } });
    const res = await checkConnection(undefined);
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/No API key/i);
    expect(h.createProviderForKey).not.toHaveBeenCalled();
  });

  it('passes the provider result straight through', async () => {
    h.providerCheck.mockResolvedValue({ ok: false, error: 'Anthropic rejected this key' });
    const res = await checkConnection('sk-bad');
    expect(res).toEqual({ ok: false, error: 'Anthropic rejected this key' });
  });
});

describe('describeConnectionFailure — reason mapping', () => {
  const withStatus = (status: number) => Object.assign(new Error('x'), { status });

  it('401 → invalid / expired / revoked', () => {
    expect(describeConnectionFailure(withStatus(401))).toMatch(/invalid, expired, or revoked/i);
  });
  it('403 → not permitted', () => {
    expect(describeConnectionFailure(withStatus(403))).toMatch(/not permitted/i);
  });
  it('429 → rate limited (key still works)', () => {
    expect(describeConnectionFailure(withStatus(429))).toMatch(/rate limited/i);
  });
  it('5xx → server error', () => {
    expect(describeConnectionFailure(withStatus(503))).toMatch(/server error/i);
  });
  it('status-less error → connection failure with the detail', () => {
    const msg = describeConnectionFailure(new Error('ECONNREFUSED'));
    expect(msg).toMatch(/couldn't reach anthropic/i);
    expect(msg).toContain('ECONNREFUSED');
  });
});
