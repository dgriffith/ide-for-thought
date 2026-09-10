/**
 * OAuth 2.1 authorization for remote MCP servers (#2030) — shared types.
 * stdio servers never go through any of this (spec: stdio credentials come
 * from the server's own process environment).
 */

/** RFC 9728 Protected Resource Metadata — tells the client which
 *  authorization server(s) protect a resource. */
export interface ProtectedResourceMetadata {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
  bearer_methods_supported?: string[];
  jwks_uri?: string;
  resource_name?: string;
  resource_documentation?: string;
  resource_policy_uri?: string;
  resource_tos_uri?: string;
}

/** RFC 8414 Authorization Server Metadata (OIDC Discovery documents are
 *  parsed into this same shape — the fields this client cares about are a
 *  strict subset of both, per `as-metadata.ts`'s doc comment). An absent
 *  `code_challenge_methods_supported` means the AS does not support PKCE —
 *  a hard refusal, not a fallback (security-considerations page). */
export interface AuthorizationServerMetadata {
  issuer: string;
  authorization_endpoint?: string;
  token_endpoint?: string;
  registration_endpoint?: string;
  response_types_supported: string[];
  scopes_supported?: string[];
  grant_types_supported?: string[];
  token_endpoint_auth_methods_supported?: string[];
  code_challenge_methods_supported?: string[];
  revocation_endpoint?: string;
  /** RFC 9207 — default false when absent. */
  authorization_response_iss_parameter_supported?: boolean;
  /** CIMD support signal, per the MCP client-registration page. */
  client_id_metadata_document_supported?: boolean;
}

export interface ClientRegistration {
  clientId: string;
  clientSecret?: string;
}

/** Everything discovery + registration produce, before the PKCE dance runs. */
export interface AuthorizationContext {
  issuer: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  resource: string;
  clientId: string;
  clientSecret?: string;
  /** Scope to request — from the challenge's own `scope=`, else PRM's
   *  `scopes_supported`, else a caller-supplied hint (step-up). */
  scope: string;
}

/** One encrypted-at-rest record per server, keyed by canonical server URL
 *  in `token-store.ts`. `scope` is the running UNION of everything granted
 *  so far (step-up appends, never replaces). */
export interface StoredOAuthRecord {
  serverUrl: string;
  issuer: string;
  clientId: string;
  clientSecret?: string;
  tokenEndpoint: string;
  resource: string;
  accessToken: string;
  refreshToken?: string;
  /** Epoch ms; absent if the AS didn't send `expires_in`. */
  expiresAt?: number;
  scope: string;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  scope: string;
}

export interface RunAuthorizationFlowOptions {
  /** Scope to request. From a 401 challenge's own `scope=` on a cold start,
   *  or the step-up scope union on a reauthorization — the caller decides
   *  which; this file just requests whatever it's given, falling back to
   *  PRM's `scopes_supported` when omitted. */
  scopeHint?: string;
  /** A 401 challenge's `resource_metadata=` param, when one was captured —
   *  skips the well-known-path guessing in `resource-metadata.ts` and goes
   *  straight to the URL the server named. */
  resourceMetadataHint?: string;
  /** The previously stored record for this server, if any (step-up always
   *  has one; a cold start never does). Used ONLY to decide whether to
   *  reuse `clientId`/`clientSecret` instead of registering a fresh client —
   *  and only when the freshly-discovered issuer still matches
   *  `existingRecord.issuer` (the spec's "Authorization Server Binding"
   *  rule: a rotated issuer must never reuse old client credentials). */
  existingRecord?: StoredOAuthRecord;
  signal?: AbortSignal;
}

export interface AuthorizationFlowResult {
  tokens: TokenResponse;
  record: StoredOAuthRecord;
}
