/**
 * PKCE + authorization-URL construction (#2030) — pure, no I/O.
 */
import { describe, it, expect } from 'vitest';
import { createHash } from 'node:crypto';
import { buildAuthorizationUrl, generatePkce, generateState } from '../../../../src/main/mcp-client/oauth/authorization-request';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

describe('generatePkce', () => {
  it('produces a 43-char URL-safe code verifier (32 random bytes)', () => {
    const { codeVerifier } = generatePkce();
    expect(codeVerifier).toHaveLength(43);
    expect(codeVerifier).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('the code challenge is the correct S256(codeVerifier)', () => {
    const { codeVerifier, codeChallenge } = generatePkce();
    const expected = base64url(createHash('sha256').update(codeVerifier).digest());
    expect(codeChallenge).toBe(expected);
  });

  it('produces a different verifier/challenge pair each call', () => {
    const a = generatePkce();
    const b = generatePkce();
    expect(a.codeVerifier).not.toBe(b.codeVerifier);
    expect(a.codeChallenge).not.toBe(b.codeChallenge);
  });
});

describe('generateState', () => {
  it('produces a URL-safe, non-empty value that varies per call', () => {
    const a = generateState();
    const b = generateState();
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(a.length).toBeGreaterThan(0);
    expect(a).not.toBe(b);
  });
});

describe('buildAuthorizationUrl', () => {
  it('includes every mandatory param, with code_challenge_method=S256', () => {
    const url = new URL(buildAuthorizationUrl({
      authorizationEndpoint: 'https://as.example.com/authorize',
      clientId: 'client-123',
      redirectUri: 'http://127.0.0.1:41417/callback',
      state: 'state-abc',
      codeChallenge: 'challenge-xyz',
      resource: 'https://mcp.example.com/mcp',
      scope: 'files:read files:write',
    }));
    expect(url.origin + url.pathname).toBe('https://as.example.com/authorize');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('client_id')).toBe('client-123');
    expect(url.searchParams.get('redirect_uri')).toBe('http://127.0.0.1:41417/callback');
    expect(url.searchParams.get('state')).toBe('state-abc');
    expect(url.searchParams.get('code_challenge')).toBe('challenge-xyz');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('resource')).toBe('https://mcp.example.com/mcp');
    expect(url.searchParams.get('scope')).toBe('files:read files:write');
  });

  it('omits the scope param entirely when scope is empty', () => {
    const url = new URL(buildAuthorizationUrl({
      authorizationEndpoint: 'https://as.example.com/authorize',
      clientId: 'client-123',
      redirectUri: 'http://127.0.0.1:41417/callback',
      state: 'state-abc',
      codeChallenge: 'challenge-xyz',
      resource: 'https://mcp.example.com/mcp',
      scope: '',
    }));
    expect(url.searchParams.has('scope')).toBe(false);
  });
});
