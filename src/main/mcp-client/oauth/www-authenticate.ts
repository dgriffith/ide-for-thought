/**
 * Pure RFC 6750 `WWW-Authenticate: Bearer ...` challenge parser (#2030). No
 * I/O — takes the raw header string `McpAuthRequiredError.wwwAuthenticate`
 * carries and extracts the params the discovery chain and step-up flow
 * need: `resource_metadata` (PRM location, RFC 9728), `scope` (what to
 * request), and `error`/`error_description` (distinguishes a plain
 * "unauthorized" 401 from a step-up-triggering `insufficient_scope` 403).
 */

export interface BearerChallenge {
  error?: string;
  error_description?: string;
  scope?: string;
  resource_metadata?: string;
}

/** Matches `key="quoted value"` or `key=unquoted-token`, RFC 6750's
 *  auth-param grammar (a simplification — real HTTP quoted-string escaping
 *  is richer, but no MCP-relevant param value needs a literal `"` or `,`). */
const PARAM_RE = /([a-zA-Z0-9_-]+)=(?:"([^"]*)"|([^\s,]+))/g;

/** Parse the whole header into its scheme + param map. Returns `null` for
 *  an empty/unparseable header (missing scheme). */
export function parseWwwAuthenticate(header: string): { scheme: string; params: Record<string, string> } | null {
  const trimmed = header.trim();
  if (!trimmed) return null;
  const spaceIdx = trimmed.indexOf(' ');
  const scheme = spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx);
  const rest = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1);

  const params: Record<string, string> = {};
  PARAM_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = PARAM_RE.exec(rest)) !== null) {
    const [, key, quoted, unquoted] = match;
    if (key) params[key] = quoted !== undefined ? quoted : (unquoted ?? '');
  }
  return { scheme, params };
}

/** Parse a header known/expected to be a `Bearer` challenge. Returns `null`
 *  if the header is missing, unparseable, or not the Bearer scheme
 *  (case-insensitive, per RFC 7235's auth-scheme token). */
export function parseBearerChallenge(header: string | null): BearerChallenge | null {
  if (!header) return null;
  const parsed = parseWwwAuthenticate(header);
  if (!parsed || parsed.scheme.toLowerCase() !== 'bearer') return null;
  const { error, error_description, scope, resource_metadata } = parsed.params;
  const challenge: BearerChallenge = {};
  if (error !== undefined) challenge.error = error;
  if (error_description !== undefined) challenge.error_description = error_description;
  if (scope !== undefined) challenge.scope = scope;
  if (resource_metadata !== undefined) challenge.resource_metadata = resource_metadata;
  return challenge;
}
