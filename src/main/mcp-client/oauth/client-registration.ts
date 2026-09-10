/**
 * Client registration priority ladder (#2030), per the MCP client-registration
 * page's own stated order:
 *   1. Pre-registered client info the caller already has for this AS —
 *      ranked ABOVE CIMD/DCR by the spec itself. This is also v1's escape
 *      hatch for an AS with neither CIMD nor DCR support (a later issue's
 *      server-config UI can expose a manual client_id/client_secret field
 *      that flows in here).
 *   2. OAuth Client ID Metadata Documents (CIMD) — the spec's now-preferred
 *      mechanism: host a metadata JSON at an HTTPS URL and use that URL as
 *      the `client_id`. Gated behind `CIMD_CLIENT_METADATA_URL` below,
 *      which stays empty until Minerva has a stable domain to host one
 *      static document at — an infrastructure decision, not a code gap.
 *      Only attempted when the AS also advertises
 *      `client_id_metadata_document_supported: true`.
 *   3. Dynamic Client Registration (RFC 7591) — "deprecated, retained for
 *      back-compat" per spec text, but operationally PRIMARY for v1 while
 *      CIMD stays unconfigured.
 */
import { McpClientRegistrationFailedError } from '../errors';
import type { AuthorizationServerMetadata, ClientRegistration } from './types';

/** Empty by default. Flip on (set to the hosted document's URL) once
 *  Minerva has a stable HTTPS URL to serve one static client-metadata JSON
 *  document at, indefinitely, with correct cache headers. A `let` behind a
 *  getter/test-only setter (matching `era.ts`'s `_setEraProbeTimeoutMsForTests`
 *  convention) rather than a plain exported const, so the CIMD branch below
 *  — real, spec-mandated code, just disabled by default — is genuinely
 *  testable without waiting on that infrastructure decision. */
let cimdClientMetadataUrl = '';

export function getCimdClientMetadataUrl(): string {
  return cimdClientMetadataUrl;
}

/** Test-only escape hatch — pass `''` to reset to the real (disabled) default. */
export function _setCimdClientMetadataUrlForTests(url: string): void {
  cimdClientMetadataUrl = url;
}

export interface ClientRegistrationOptions {
  /** A caller-supplied client already registered with this AS out of band —
   *  checked first, before CIMD/DCR are ever attempted. */
  preRegistered?: ClientRegistration;
  redirectUris: string[];
  scope?: string;
  signal?: AbortSignal;
}

interface DcrResponse {
  client_id: string;
  client_secret?: string;
}

function isDcrResponse(v: unknown): v is DcrResponse {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).client_id === 'string';
}

async function registerViaDcr(
  registrationEndpoint: string,
  opts: ClientRegistrationOptions,
): Promise<ClientRegistration> {
  const body = {
    redirect_uris: opts.redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code'],
    response_types: ['code'],
    client_name: 'Minerva',
    // Required by the MCP client-registration page's OIDC-DCR-extension
    // note: omitting this defaults to "web" under OIDC and can conflict
    // with a loopback redirect URI.
    application_type: 'native',
    ...(opts.scope ? { scope: opts.scope } : {}),
  };

  let res: Response;
  try {
    res = await fetch(registrationEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });
  } catch (err) {
    throw new McpClientRegistrationFailedError(
      `dynamic client registration request failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  if (!res.ok) {
    throw new McpClientRegistrationFailedError(`dynamic client registration returned HTTP ${res.status}`);
  }
  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new McpClientRegistrationFailedError('dynamic client registration response was not valid JSON');
  }
  if (!isDcrResponse(parsed)) {
    throw new McpClientRegistrationFailedError('dynamic client registration response was missing client_id');
  }
  const registration: ClientRegistration = { clientId: parsed.client_id };
  if (parsed.client_secret) registration.clientSecret = parsed.client_secret;
  return registration;
}

/** Run the priority ladder against one AS's metadata. Throws
 *  `McpClientRegistrationFailedError` if nothing in the ladder is available. */
export async function registerClient(
  metadata: AuthorizationServerMetadata,
  opts: ClientRegistrationOptions,
): Promise<ClientRegistration> {
  if (opts.preRegistered) return opts.preRegistered;

  const cimdUrl = getCimdClientMetadataUrl();
  if (cimdUrl && metadata.client_id_metadata_document_supported) {
    return { clientId: cimdUrl };
  }

  if (metadata.registration_endpoint) {
    return registerViaDcr(metadata.registration_endpoint, opts);
  }

  throw new McpClientRegistrationFailedError(
    `no client registration mechanism available for issuer ${metadata.issuer} `
      + '(no pre-registered client, CIMD unconfigured/unsupported, no registration_endpoint)',
  );
}
