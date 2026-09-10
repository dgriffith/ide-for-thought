/**
 * RFC 6750 `WWW-Authenticate: Bearer ...` challenge parsing (#2030) — the
 * 401 (needs-auth) and 403 (insufficient_scope) shapes verbatim from the spec.
 */
import { describe, it, expect } from 'vitest';
import { parseBearerChallenge, parseWwwAuthenticate } from '../../../../src/main/mcp-client/oauth/www-authenticate';

describe('parseWwwAuthenticate', () => {
  it('returns null for an empty header', () => {
    expect(parseWwwAuthenticate('')).toBeNull();
  });

  it('parses a scheme with no params', () => {
    expect(parseWwwAuthenticate('Bearer')).toEqual({ scheme: 'Bearer', params: {} });
  });

  it('parses quoted params', () => {
    const parsed = parseWwwAuthenticate('Bearer realm="example", scope="files:read"');
    expect(parsed).toEqual({ scheme: 'Bearer', params: { realm: 'example', scope: 'files:read' } });
  });
});

describe('parseBearerChallenge', () => {
  it('returns null for a null header', () => {
    expect(parseBearerChallenge(null)).toBeNull();
  });

  it('returns null for a non-Bearer scheme', () => {
    expect(parseBearerChallenge('Basic realm="example"')).toBeNull();
  });

  it('is case-insensitive on the scheme', () => {
    expect(parseBearerChallenge('bearer scope="files:read"')).toEqual({ scope: 'files:read' });
  });

  it('parses the 401 "needs auth" shape (resource_metadata + scope)', () => {
    const header = 'Bearer resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", scope="files:read"';
    expect(parseBearerChallenge(header)).toEqual({
      resource_metadata: 'https://mcp.example.com/.well-known/oauth-protected-resource',
      scope: 'files:read',
    });
  });

  it('parses the 403 "insufficient_scope" shape (error + scope + resource_metadata + error_description)', () => {
    const header =
      'Bearer error="insufficient_scope", scope="files:write", '
      + 'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource", '
      + 'error_description="Additional scope required"';
    expect(parseBearerChallenge(header)).toEqual({
      error: 'insufficient_scope',
      scope: 'files:write',
      resource_metadata: 'https://mcp.example.com/.well-known/oauth-protected-resource',
      error_description: 'Additional scope required',
    });
  });
});
