/**
 * Token-endpoint requests (#2030) — the authorization_code grant (initial
 * exchange) and the refresh_token grant, both `application/x-www-form-urlencoded`
 * POSTs, both public-client shaped (`token_endpoint_auth_method: none` — no
 * Basic auth; `client_secret` is only ever sent when one was actually
 * issued, which is unusual for a native app). Both grants MUST also include
 * the RFC 8707 `resource` parameter, binding the issued/refreshed token to
 * this specific server.
 */
import { McpConnectionError } from '../errors';
import type { TokenResponse } from './types';

interface TokenEndpointResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  scope?: string;
}

function isTokenEndpointResponse(v: unknown): v is TokenEndpointResponse {
  return typeof v === 'object' && v !== null && typeof (v as Record<string, unknown>).access_token === 'string';
}

function errorFields(v: unknown): { error?: string; error_description?: string } {
  if (typeof v !== 'object' || v === null) return {};
  const o = v as Record<string, unknown>;
  return {
    ...(typeof o.error === 'string' ? { error: o.error } : {}),
    ...(typeof o.error_description === 'string' ? { error_description: o.error_description } : {}),
  };
}

async function postTokenRequest(
  tokenEndpoint: string,
  body: URLSearchParams,
  signal?: AbortSignal,
): Promise<TokenResponse> {
  let res: Response;
  try {
    res = await fetch(tokenEndpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      ...(signal ? { signal } : {}),
    });
  } catch (err) {
    throw new McpConnectionError(`token request failed: ${err instanceof Error ? err.message : String(err)}`);
  }

  let parsed: unknown;
  try {
    parsed = await res.json();
  } catch {
    throw new McpConnectionError(`token endpoint returned a non-JSON response (HTTP ${res.status})`);
  }

  if (!res.ok || !isTokenEndpointResponse(parsed)) {
    const { error, error_description } = errorFields(parsed);
    throw new McpConnectionError(
      `token request failed (HTTP ${res.status}): ${error ?? 'unknown error'}${error_description ? ` — ${error_description}` : ''}`,
      parsed,
    );
  }

  const tokens: TokenResponse = { accessToken: parsed.access_token, scope: parsed.scope ?? '' };
  if (parsed.refresh_token) tokens.refreshToken = parsed.refresh_token;
  if (typeof parsed.expires_in === 'number') tokens.expiresAt = Date.now() + parsed.expires_in * 1000;
  return tokens;
}

export interface ExchangeAuthorizationCodeParams {
  tokenEndpoint: string;
  code: string;
  redirectUri: string;
  clientId: string;
  clientSecret?: string;
  codeVerifier: string;
  resource: string;
  signal?: AbortSignal;
}

export function exchangeAuthorizationCode(params: ExchangeAuthorizationCodeParams): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: params.code,
    redirect_uri: params.redirectUri,
    client_id: params.clientId,
    code_verifier: params.codeVerifier,
    resource: params.resource,
  });
  if (params.clientSecret) body.set('client_secret', params.clientSecret);
  return postTokenRequest(params.tokenEndpoint, body, params.signal);
}

export interface RefreshAccessTokenParams {
  tokenEndpoint: string;
  refreshToken: string;
  clientId: string;
  clientSecret?: string;
  resource: string;
  signal?: AbortSignal;
}

/** Note: per OAuth 2.1 §4.3, a refresh request's `scope` can only NARROW
 *  previously granted scope, never widen it — step-up must never call this
 *  with an expanded scope; it always runs a fresh authorization-code flow
 *  instead (see `step-up.ts`/`flow.ts`). This function never sends `scope`
 *  at all, so it always requests exactly what the refresh token allows. */
export function refreshAccessToken(params: RefreshAccessTokenParams): Promise<TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: params.refreshToken,
    client_id: params.clientId,
    resource: params.resource,
  });
  if (params.clientSecret) body.set('client_secret', params.clientSecret);
  return postTokenRequest(params.tokenEndpoint, body, params.signal);
}
