/**
 * RFC 9728 Protected Resource Metadata discovery (#2030) — mocked `fetch`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { canonicalServerUri, discoverProtectedResourceMetadata } from '../../../../src/main/mcp-client/oauth/resource-metadata';
import { McpOAuthDiscoveryError } from '../../../../src/main/mcp-client/errors';

afterEach(() => vi.unstubAllGlobals());

describe('canonicalServerUri', () => {
  it('strips a redundant default https port', () => {
    expect(canonicalServerUri('https://mcp.example.com:443/mcp')).toBe('https://mcp.example.com/mcp');
  });
  it('strips a redundant default http port', () => {
    expect(canonicalServerUri('http://mcp.example.com:80/mcp')).toBe('http://mcp.example.com/mcp');
  });
  it('keeps a non-default port', () => {
    expect(canonicalServerUri('https://mcp.example.com:8443/mcp')).toBe('https://mcp.example.com:8443/mcp');
  });
  it('strips a trailing slash on a non-root path', () => {
    expect(canonicalServerUri('https://mcp.example.com/mcp/')).toBe('https://mcp.example.com/mcp');
  });
  it('keeps the root path as-is', () => {
    expect(canonicalServerUri('https://mcp.example.com/')).toBe('https://mcp.example.com/');
  });
  it('strips a hash fragment', () => {
    expect(canonicalServerUri('https://mcp.example.com/mcp#frag')).toBe('https://mcp.example.com/mcp');
  });
});

const PRM = { resource: 'https://mcp.example.com/mcp', authorization_servers: ['https://as.example.com'] };

describe('discoverProtectedResourceMetadata', () => {
  it('uses the resource_metadata hint directly when given', async () => {
    const fetchMock = vi.fn(async (url: string) => {
      expect(url).toBe('https://mcp.example.com/custom-prm.json');
      return new Response(JSON.stringify(PRM), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await discoverProtectedResourceMetadata('https://mcp.example.com/mcp', 'https://mcp.example.com/custom-prm.json');
    expect(result).toEqual(PRM);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('tries the well-known sub-path form first, then the root form', async () => {
    const tried: string[] = [];
    vi.stubGlobal('fetch', vi.fn(async (url: string) => {
      tried.push(url);
      if (url === 'https://mcp.example.com/.well-known/oauth-protected-resource/mcp') {
        return new Response(null, { status: 404 });
      }
      return new Response(JSON.stringify(PRM), { status: 200 });
    }));
    const result = await discoverProtectedResourceMetadata('https://mcp.example.com/mcp', null);
    expect(result).toEqual(PRM);
    expect(tried).toEqual([
      'https://mcp.example.com/.well-known/oauth-protected-resource/mcp',
      'https://mcp.example.com/.well-known/oauth-protected-resource',
    ]);
  });

  it('succeeds directly from the sub-path form when it works', async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(PRM), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await discoverProtectedResourceMetadata('https://mcp.example.com/mcp', null);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws McpOAuthDiscoveryError, naming every URL tried, when nothing works', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 404 })));
    await expect(discoverProtectedResourceMetadata('https://mcp.example.com/mcp', null)).rejects.toMatchObject({
      constructor: McpOAuthDiscoveryError,
      details: {
        tried: [
          'https://mcp.example.com/.well-known/oauth-protected-resource/mcp',
          'https://mcp.example.com/.well-known/oauth-protected-resource',
        ],
      },
    });
  });

  it('rejects a document missing authorization_servers', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ resource: 'x' }), { status: 200 })));
    await expect(discoverProtectedResourceMetadata('https://mcp.example.com/mcp', null)).rejects.toThrow(McpOAuthDiscoveryError);
  });

  it('rejects a malformed (non-JSON) response and continues the ladder', async () => {
    let calls = 0;
    vi.stubGlobal('fetch', vi.fn(async () => {
      calls += 1;
      if (calls === 1) return new Response('not json', { status: 200 });
      return new Response(JSON.stringify(PRM), { status: 200 });
    }));
    const result = await discoverProtectedResourceMetadata('https://mcp.example.com/mcp', null);
    expect(result).toEqual(PRM);
  });
});
