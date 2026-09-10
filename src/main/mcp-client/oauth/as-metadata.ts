/**
 * Authorization Server metadata discovery (#2030) — RFC 8414 and OpenID
 * Connect Discovery share ONE fallback ladder here, not two separate
 * implementations, because the spec defines them as one ordered sequence
 * against the same issuer (PRM discovery, in `resource-metadata.ts`, is
 * what tells the client *which* issuer; this probes *that* issuer):
 *
 *   path-bearing issuer (e.g. `https://as.example.com/tenant1`):
 *     1. RFC 8414 path-insertion:  /.well-known/oauth-authorization-server/tenant1
 *     2. OIDC path-insertion:      /.well-known/openid-configuration/tenant1
 *     3. OIDC path-appending:      /tenant1/.well-known/openid-configuration
 *   path-less issuer:
 *     1. /.well-known/oauth-authorization-server
 *     2. /.well-known/openid-configuration
 *
 * Every candidate is validated against the SAME mix-up defense: the fetched
 * document's own `issuer` field must exactly (string-equal, not
 * URL-normalized) match the issuer being probed, or it's discarded and the
 * ladder continues — RFC 8414 §3.3 / OIDC §4.3.
 */
import { logger } from '../../../shared/logger';
import { McpOAuthDiscoveryError } from '../errors';
import type { AuthorizationServerMetadata } from './types';

function buildCandidateUrls(issuer: string): string[] {
  const u = new URL(issuer);
  const path = u.pathname === '/' ? '' : u.pathname.replace(/\/$/, '');
  if (path) {
    return [
      `${u.origin}/.well-known/oauth-authorization-server${path}`,
      `${u.origin}/.well-known/openid-configuration${path}`,
      `${u.origin}${path}/.well-known/openid-configuration`,
    ];
  }
  return [
    `${u.origin}/.well-known/oauth-authorization-server`,
    `${u.origin}/.well-known/openid-configuration`,
  ];
}

function isAuthorizationServerMetadata(v: unknown): v is AuthorizationServerMetadata {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return typeof o.issuer === 'string' && Array.isArray(o.response_types_supported);
}

async function tryFetchAsMetadata(
  url: string,
  expectedIssuer: string,
  signal?: AbortSignal,
): Promise<AuthorizationServerMetadata | null> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) });
  } catch (err) {
    logger('mcp-client').debug(`authorization server metadata candidate unreachable, trying the next one: ${url}`, err);
    return null;
  }
  if (!res.ok) return null;
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    logger('mcp-client').debug(`authorization server metadata candidate returned non-JSON, trying the next one: ${url}`, err);
    return null;
  }
  if (!isAuthorizationServerMetadata(parsed)) return null;
  if (parsed.issuer !== expectedIssuer) return null; // mix-up defense
  return parsed;
}

/** Probe `issuer` via the fallback ladder above. Throws
 *  `McpOAuthDiscoveryError` (carrying every URL tried) if nothing yields a
 *  well-formed, issuer-matching document. */
export async function discoverAuthorizationServerMetadata(
  issuer: string,
  signal?: AbortSignal,
): Promise<AuthorizationServerMetadata> {
  const candidates = buildCandidateUrls(issuer);
  for (const url of candidates) {
    const metadata = await tryFetchAsMetadata(url, issuer, signal);
    if (metadata) return metadata;
  }
  throw new McpOAuthDiscoveryError(
    `could not discover authorization server metadata for issuer ${issuer}`,
    { tried: candidates },
  );
}
