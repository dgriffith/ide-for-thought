/**
 * Token-endpoint requests (#2030) — authorization_code and refresh_token
 * grants, both including the RFC 8707 `resource` parameter.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { exchangeAuthorizationCode, refreshAccessToken } from '../../../../src/main/mcp-client/oauth/token-exchange';
import { McpConnectionError } from '../../../../src/main/mcp-client/errors';

afterEach(() => vi.unstubAllGlobals());

function parseBody(init?: RequestInit): URLSearchParams {
  return new URLSearchParams(init?.body as string);
}

describe('exchangeAuthorizationCode', () => {
  it('POSTs the correct grant with every mandatory field, including resource', async () => {
    let seenHeaders: Record<string, string> = {};
    let seenBody: URLSearchParams = new URLSearchParams();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seenHeaders = init?.headers as Record<string, string>;
      seenBody = parseBody(init);
      return new Response(JSON.stringify({ access_token: 'at-1', token_type: 'Bearer', expires_in: 3600, refresh_token: 'rt-1', scope: 'files:read' }), { status: 200 });
    }));
    const result = await exchangeAuthorizationCode({
      tokenEndpoint: 'https://as.example.com/token',
      code: 'auth-code',
      redirectUri: 'http://127.0.0.1:41417/callback',
      clientId: 'client-1',
      codeVerifier: 'verifier-1',
      resource: 'https://mcp.example.com/mcp',
    });
    expect(seenHeaders['Content-Type']).toBe('application/x-www-form-urlencoded');
    expect(seenBody.get('grant_type')).toBe('authorization_code');
    expect(seenBody.get('code')).toBe('auth-code');
    expect(seenBody.get('redirect_uri')).toBe('http://127.0.0.1:41417/callback');
    expect(seenBody.get('client_id')).toBe('client-1');
    expect(seenBody.get('code_verifier')).toBe('verifier-1');
    expect(seenBody.get('resource')).toBe('https://mcp.example.com/mcp');
    expect(seenBody.has('client_secret')).toBe(false);

    expect(result.accessToken).toBe('at-1');
    expect(result.refreshToken).toBe('rt-1');
    expect(result.scope).toBe('files:read');
    expect(result.expiresAt).toBeGreaterThan(Date.now());
  });

  it('includes client_secret only when one is given', async () => {
    let seenBody: URLSearchParams = new URLSearchParams();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seenBody = parseBody(init);
      return new Response(JSON.stringify({ access_token: 'at-1', scope: '' }), { status: 200 });
    }));
    await exchangeAuthorizationCode({
      tokenEndpoint: 'https://as.example.com/token',
      code: 'auth-code',
      redirectUri: 'http://127.0.0.1:41417/callback',
      clientId: 'client-1',
      clientSecret: 'shh',
      codeVerifier: 'verifier-1',
      resource: 'https://mcp.example.com/mcp',
    });
    expect(seenBody.get('client_secret')).toBe('shh');
  });

  it('tolerates a response with no refresh_token or expires_in', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ access_token: 'at-1', scope: 'x' }), { status: 200 })));
    const result = await exchangeAuthorizationCode({
      tokenEndpoint: 'https://as.example.com/token', code: 'c', redirectUri: 'r', clientId: 'id', codeVerifier: 'v', resource: 'res',
    });
    expect(result).toEqual({ accessToken: 'at-1', scope: 'x' });
  });

  it('throws McpConnectionError with the error/error_description on a failure response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ error: 'invalid_grant', error_description: 'code expired' }), { status: 400 })));
    await expect(
      exchangeAuthorizationCode({ tokenEndpoint: 't', code: 'c', redirectUri: 'r', clientId: 'id', codeVerifier: 'v', resource: 'res' }),
    ).rejects.toMatchObject({ constructor: McpConnectionError, message: expect.stringContaining('invalid_grant') });
  });

  it('throws McpConnectionError on a non-JSON response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json', { status: 200 })));
    await expect(
      exchangeAuthorizationCode({ tokenEndpoint: 't', code: 'c', redirectUri: 'r', clientId: 'id', codeVerifier: 'v', resource: 'res' }),
    ).rejects.toThrow(McpConnectionError);
  });

  it('throws McpConnectionError when the request itself fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network down'); }));
    await expect(
      exchangeAuthorizationCode({ tokenEndpoint: 't', code: 'c', redirectUri: 'r', clientId: 'id', codeVerifier: 'v', resource: 'res' }),
    ).rejects.toThrow(McpConnectionError);
  });
});

describe('refreshAccessToken', () => {
  it('POSTs a refresh_token grant with resource, and never sends a scope param', async () => {
    let seenBody: URLSearchParams = new URLSearchParams();
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seenBody = parseBody(init);
      return new Response(JSON.stringify({ access_token: 'at-2', scope: 'files:read' }), { status: 200 });
    }));
    await refreshAccessToken({
      tokenEndpoint: 'https://as.example.com/token',
      refreshToken: 'rt-1',
      clientId: 'client-1',
      resource: 'https://mcp.example.com/mcp',
    });
    expect(seenBody.get('grant_type')).toBe('refresh_token');
    expect(seenBody.get('refresh_token')).toBe('rt-1');
    expect(seenBody.get('resource')).toBe('https://mcp.example.com/mcp');
    expect(seenBody.has('scope')).toBe(false);
  });
});
