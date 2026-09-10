/**
 * RFC 9728 Protected Resource Metadata discovery (#2030) — tells the client
 * which authorization server(s) protect a given MCP server, plus the
 * canonical resource identifier RFC 8707 binds tokens to.
 *
 * Discovery order (MCP authorization-server-discovery page): (1) if the
 * 401's `WWW-Authenticate` carried a `resource_metadata=` param, GET that
 * URL directly; else (2) GET the well-known sub-path form
 * (`https://<host>/.well-known/oauth-protected-resource<path>`); if that
 * 404s or errors, (3) GET the well-known root form
 * (`https://<host>/.well-known/oauth-protected-resource`). A compliant
 * client MUST support both (2) and (3), not just one.
 */
import { logger } from '../../../shared/logger';
import { McpOAuthDiscoveryError } from '../errors';
import type { ProtectedResourceMetadata } from './types';

/** RFC 8707 resource binding needs a stable identifier for "this server" —
 *  normalize away a redundant default port and a trailing slash on a
 *  non-root path so trivially-equivalent URLs bind to the same token. */
export function canonicalServerUri(url: string): string {
  const u = new URL(url);
  u.hash = '';
  if ((u.protocol === 'https:' && u.port === '443') || (u.protocol === 'http:' && u.port === '80')) {
    u.port = '';
  }
  if (u.pathname.length > 1 && u.pathname.endsWith('/')) {
    u.pathname = u.pathname.slice(0, -1);
  }
  return u.toString();
}

function wellKnownSubPathUrl(serverUrl: string): string {
  const u = new URL(serverUrl);
  const path = u.pathname === '/' ? '' : u.pathname;
  return `${u.origin}/.well-known/oauth-protected-resource${path}`;
}

function wellKnownRootUrl(serverUrl: string): string {
  const u = new URL(serverUrl);
  return `${u.origin}/.well-known/oauth-protected-resource`;
}

function isProtectedResourceMetadata(v: unknown): v is ProtectedResourceMetadata {
  if (typeof v !== 'object' || v === null) return false;
  const o = v as Record<string, unknown>;
  return (
    typeof o.resource === 'string'
    && Array.isArray(o.authorization_servers)
    && o.authorization_servers.length > 0
    && o.authorization_servers.every((s) => typeof s === 'string')
  );
}

async function tryFetchMetadata(url: string, signal?: AbortSignal): Promise<ProtectedResourceMetadata | null> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Accept: 'application/json' }, ...(signal ? { signal } : {}) });
  } catch (err) {
    logger('mcp-client').debug(`protected resource metadata candidate unreachable, trying the next one: ${url}`, err);
    return null;
  }
  if (!res.ok) return null;
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch (err) {
    logger('mcp-client').debug(`protected resource metadata candidate returned non-JSON, trying the next one: ${url}`, err);
    return null;
  }
  return isProtectedResourceMetadata(parsed) ? parsed : null;
}

/**
 * Discover PRM for `serverUrl`. `resourceMetadataHint` is the
 * `WWW-Authenticate` header's `resource_metadata` param, when present (from
 * `parseBearerChallenge`) — when given, it's the ONLY candidate tried (the
 * server told us exactly where to look); otherwise both well-known forms
 * are tried in order. Throws `McpOAuthDiscoveryError` (carrying every URL
 * tried) if nothing yields a well-formed document.
 */
export async function discoverProtectedResourceMetadata(
  serverUrl: string,
  resourceMetadataHint: string | null,
  signal?: AbortSignal,
): Promise<ProtectedResourceMetadata> {
  const candidates = resourceMetadataHint
    ? [resourceMetadataHint]
    : [wellKnownSubPathUrl(serverUrl), wellKnownRootUrl(serverUrl)];

  for (const url of candidates) {
    const metadata = await tryFetchMetadata(url, signal);
    if (metadata) return metadata;
  }
  throw new McpOAuthDiscoveryError(
    `could not discover protected resource metadata for ${serverUrl}`,
    { tried: candidates },
  );
}
