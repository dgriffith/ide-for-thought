/**
 * Pure PKCE + authorization-URL construction (#2030). No I/O — generates
 * the verifier/challenge/state and assembles the authorization-endpoint URL
 * the browser gets pointed at. S256 is always used (Node's `crypto` always
 * has SHA-256 available, so the spec's "MUST use S256 when technically
 * capable" leaves no reason to ever fall back to `plain`).
 */
import { createHash, randomBytes } from 'node:crypto';

function base64url(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export interface PkcePair {
  /** 43 chars for 32 random bytes — within RFC 7636's 43-128 char range,
   *  URL-safe alphabet throughout. */
  codeVerifier: string;
  codeChallenge: string;
}

export function generatePkce(): PkcePair {
  const codeVerifier = base64url(randomBytes(32));
  const codeChallenge = base64url(createHash('sha256').update(codeVerifier).digest());
  return { codeVerifier, codeChallenge };
}

/** CSRF-style correlation value for the authorization response — validated
 *  on callback before anything else in the response is trusted. */
export function generateState(): string {
  return base64url(randomBytes(16));
}

export interface AuthorizationUrlParams {
  authorizationEndpoint: string;
  clientId: string;
  redirectUri: string;
  state: string;
  codeChallenge: string;
  /** RFC 8707 — the canonical URI of the MCP server this token will be
   *  scoped to. Mandatory in practice (binds the token so it can't be
   *  replayed against a different server). */
  resource: string;
  scope: string;
}

export function buildAuthorizationUrl(params: AuthorizationUrlParams): string {
  const url = new URL(params.authorizationEndpoint);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', params.clientId);
  url.searchParams.set('redirect_uri', params.redirectUri);
  url.searchParams.set('state', params.state);
  url.searchParams.set('code_challenge', params.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('resource', params.resource);
  if (params.scope) url.searchParams.set('scope', params.scope);
  return url.toString();
}
