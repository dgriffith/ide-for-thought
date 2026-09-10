/**
 * RFC 8414 + OIDC Discovery fallback ladder (#2030) — mocked `fetch`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { discoverAuthorizationServerMetadata } from '../../../../src/main/mcp-client/oauth/as-metadata';
import { McpOAuthDiscoveryError } from '../../../../src/main/mcp-client/errors';

afterEach(() => vi.unstubAllGlobals());

function metadata(issuer: string) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/authorize`,
    token_endpoint: `${issuer}/token`,
    response_types_supported: ['code'],
    code_challenge_methods_supported: ['S256'],
  };
}

describe('discoverAuthorizationServerMetadata — path-less issuer', () => {
  it('tries RFC 8414 then OIDC discovery, in order', async () => {
    const tried: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      tried.push(url);
      if (url === 'https://as.example.com/.well-known/oauth-authorization-server') {
        return new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify(metadata('https://as.example.com')), { status: 200 });
    }));
    const result = await discoverAuthorizationServerMetadata('https://as.example.com');
    expect(result.issuer).toBe('https://as.example.com');
    expect(tried).toEqual([
      'https://as.example.com/.well-known/oauth-authorization-server',
      'https://as.example.com/.well-known/openid-configuration',
    ]);
  });
});

describe('discoverAuthorizationServerMetadata — path-bearing issuer', () => {
  it('tries path-insertion (RFC 8414), path-insertion (OIDC), then path-appending (OIDC), in order', async () => {
    const tried: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      tried.push(url);
      return new Response(null, { status: 404 }); // exhaust the whole ladder
    }));
    await expect(discoverAuthorizationServerMetadata('https://as.example.com/tenant1')).rejects.toThrow(McpOAuthDiscoveryError);
    expect(tried).toEqual([
      'https://as.example.com/.well-known/oauth-authorization-server/tenant1',
      'https://as.example.com/.well-known/openid-configuration/tenant1',
      'https://as.example.com/tenant1/.well-known/openid-configuration',
    ]);
  });

  it('succeeds on the OIDC path-appending candidate', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      if (url === 'https://as.example.com/tenant1/.well-known/openid-configuration') {
        return new Response(JSON.stringify(metadata('https://as.example.com/tenant1')), { status: 200 });
      }
      return new Response(null, { status: 404 });
    }));
    const result = await discoverAuthorizationServerMetadata('https://as.example.com/tenant1');
    expect(result.issuer).toBe('https://as.example.com/tenant1');
  });
});

describe('mix-up defense', () => {
  it('rejects a document whose issuer field does not match the probed issuer, and continues the ladder', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) {
        // A malicious/misconfigured server claiming to be a different issuer.
        return new Response(JSON.stringify(metadata('https://attacker.example.com')), { status: 200 });
      }
      return new Response(JSON.stringify(metadata('https://as.example.com')), { status: 200 });
    }));
    const result = await discoverAuthorizationServerMetadata('https://as.example.com');
    expect(result.issuer).toBe('https://as.example.com');
    expect(calls).toBe(2);
  });

  it('throws if every candidate is issuer-mismatched', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(metadata('https://attacker.example.com')), { status: 200 })));
    await expect(discoverAuthorizationServerMetadata('https://as.example.com')).rejects.toThrow(McpOAuthDiscoveryError);
  });
});

describe('malformed responses', () => {
  it('rejects a document missing response_types_supported', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ issuer: 'https://as.example.com' }), { status: 200 })));
    await expect(discoverAuthorizationServerMetadata('https://as.example.com')).rejects.toThrow(McpOAuthDiscoveryError);
  });

  it('rejects a non-JSON body and continues the ladder', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response('not json', { status: 200 });
      return new Response(JSON.stringify(metadata('https://as.example.com')), { status: 200 });
    }));
    const result = await discoverAuthorizationServerMetadata('https://as.example.com');
    expect(result.issuer).toBe('https://as.example.com');
  });

  it('rejects a well-formed JSON body that is not an object (e.g. a bare string) and continues the ladder', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response(JSON.stringify('just a string'), { status: 200 });
      return new Response(JSON.stringify(metadata('https://as.example.com')), { status: 200 });
    }));
    const result = await discoverAuthorizationServerMetadata('https://as.example.com');
    expect(result.issuer).toBe('https://as.example.com');
  });

  it('rejects a literal JSON null body and continues the ladder', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response('null', { status: 200 });
      return new Response(JSON.stringify(metadata('https://as.example.com')), { status: 200 });
    }));
    const result = await discoverAuthorizationServerMetadata('https://as.example.com');
    expect(result.issuer).toBe('https://as.example.com');
  });

  it('treats a candidate that throws (network failure) the same as a miss, and continues the ladder', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('network down');
      return new Response(JSON.stringify(metadata('https://as.example.com')), { status: 200 });
    }));
    const result = await discoverAuthorizationServerMetadata('https://as.example.com');
    expect(result.issuer).toBe('https://as.example.com');
    expect(calls).toBe(2);
  });
});
