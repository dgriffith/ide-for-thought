/**
 * OAuth 2.1 orchestrator (#2030) — the only file in `oauth/` that calls the
 * others in sequence. Three exports: `connectMcpServerWithOAuth` (the
 * public entry point), `runAuthorizationFlow` (the full discovery →
 * registration → PKCE → callback → token-exchange dance, exported so it's
 * independently testable and so `reauthorizeWithStepUp` can reuse it
 * verbatim), and `reauthorizeWithStepUp`.
 *
 * `connectMcpServer`/`client.ts` (#2029) stay untouched — OAuth is a new,
 * explicit sibling, never woven into it, so a background "reconnect my
 * saved servers on startup" call can never surprise the user with a popped
 * browser tab (see `McpOAuthConnectOptions.interactive`).
 */
import { shell } from 'electron';
import { logger } from '../../../shared/logger';
import { connectMcpServer, type ConnectMcpServerOptions, type McpClient } from '../client';
import {
  McpAuthRequiredError,
  McpInteractiveAuthRequiredError,
  McpOAuthDiscoveryError,
  McpPkceUnsupportedError,
  McpStepUpRequiredError,
} from '../errors';
import type { McpServerDescriptor } from '../types';
import { discoverAuthorizationServerMetadata } from './as-metadata';
import { buildAuthorizationUrl, generatePkce, generateState } from './authorization-request';
import { startCallbackListener } from './callback-server';
import { registerClient } from './client-registration';
import { validateIssuer } from './issuer-validation';
import { canonicalServerUri, discoverProtectedResourceMetadata } from './resource-metadata';
import { clearStepUpAttempts, recordStepUpAttempt, unionScopes } from './step-up';
import { exchangeAuthorizationCode, refreshAccessToken } from './token-exchange';
import { deleteStoredTokens, getStoredTokens, saveStoredTokens } from './token-store';
import type { AuthorizationFlowResult, RunAuthorizationFlowOptions, StoredOAuthRecord, TokenResponse } from './types';
import { parseBearerChallenge } from './www-authenticate';

type HttpDescriptor = Extract<McpServerDescriptor, { kind: 'http' }>;

export interface McpOAuthConnectOptions extends ConnectMcpServerOptions {
  /** True only when the caller already confirmed a browser may open now
   *  (the user just clicked Connect). False for background/startup
   *  reconnects: if no valid/refreshable token exists, throws
   *  `McpInteractiveAuthRequiredError` instead of ever calling
   *  `shell.openExternal`. */
  interactive: boolean;
}

function withBearer(descriptor: HttpDescriptor, accessToken: string): HttpDescriptor {
  return { ...descriptor, headers: { ...descriptor.headers, Authorization: `Bearer ${accessToken}` } };
}

async function openAuthorizationUrl(url: string): Promise<void> {
  const parsed = new URL(url);
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new McpOAuthDiscoveryError(`refusing to open a non-http(s) authorization URL: ${url}`);
  }
  await shell.openExternal(parsed.toString());
}

async function tryRefresh(stored: StoredOAuthRecord, signal?: AbortSignal): Promise<TokenResponse | null> {
  if (!stored.refreshToken) return null;
  try {
    return await refreshAccessToken({
      tokenEndpoint: stored.tokenEndpoint,
      refreshToken: stored.refreshToken,
      clientId: stored.clientId,
      resource: stored.resource,
      ...(stored.clientSecret ? { clientSecret: stored.clientSecret } : {}),
      ...(signal ? { signal } : {}),
    });
  } catch {
    return null; // dead refresh token — caller falls through to a cold start
  }
}

// One in-flight flow per server — two near-simultaneous connect attempts
// for the same URL await the same flow rather than popping two browser
// tabs and binding two callback listeners.
const inFlightFlows = new Map<string, Promise<AuthorizationFlowResult>>();

/**
 * The full discovery → registration → PKCE → callback → token-exchange
 * sequence for one server. Always runs fresh discovery, even when
 * `opts.existingRecord` is given (an AS's endpoints can change) — the
 * existing record is consulted ONLY to decide whether to reuse its
 * `clientId`/`clientSecret` instead of registering a new client, and only
 * when the freshly-discovered issuer still matches the record's issuer
 * (the spec's "Authorization Server Binding" rule: a rotated issuer must
 * never reuse old client credentials).
 */
export async function runAuthorizationFlow(
  serverUrl: string,
  opts: RunAuthorizationFlowOptions = {},
): Promise<AuthorizationFlowResult> {
  const existing = inFlightFlows.get(serverUrl);
  if (existing) return existing;
  const promise = runAuthorizationFlowInner(serverUrl, opts).finally(() => inFlightFlows.delete(serverUrl));
  inFlightFlows.set(serverUrl, promise);
  return promise;
}

async function runAuthorizationFlowInner(
  serverUrl: string,
  opts: RunAuthorizationFlowOptions,
): Promise<AuthorizationFlowResult> {
  const prm = await discoverProtectedResourceMetadata(serverUrl, opts.resourceMetadataHint ?? null, opts.signal);
  const issuer = prm.authorization_servers[0]; // v1: first entry — see resource-metadata.ts's doc comment
  if (!issuer) {
    throw new McpOAuthDiscoveryError(`protected resource metadata for ${serverUrl} named no authorization_servers`);
  }

  const asMetadata = await discoverAuthorizationServerMetadata(issuer, opts.signal);
  if (!asMetadata.code_challenge_methods_supported || asMetadata.code_challenge_methods_supported.length === 0) {
    throw new McpPkceUnsupportedError(issuer);
  }
  const authorizationEndpoint = asMetadata.authorization_endpoint;
  const tokenEndpoint = asMetadata.token_endpoint;
  if (!authorizationEndpoint || !tokenEndpoint) {
    throw new McpOAuthDiscoveryError(`authorization server ${issuer} is missing authorization_endpoint or token_endpoint`);
  }

  const resource = canonicalServerUri(prm.resource || serverUrl);
  const scope = opts.scopeHint || (prm.scopes_supported ?? []).join(' ');

  const callback = await startCallbackListener(opts.signal);
  try {
    const reuseClient = opts.existingRecord?.issuer === issuer ? opts.existingRecord : undefined;
    const registration = await registerClient(asMetadata, {
      ...(reuseClient
        ? {
            preRegistered: {
              clientId: reuseClient.clientId,
              ...(reuseClient.clientSecret ? { clientSecret: reuseClient.clientSecret } : {}),
            },
          }
        : {}),
      redirectUris: [callback.redirectUri],
      scope,
      ...(opts.signal ? { signal: opts.signal } : {}),
    });

    const { codeVerifier, codeChallenge } = generatePkce();
    const state = generateState();
    const authorizationUrl = buildAuthorizationUrl({
      authorizationEndpoint,
      clientId: registration.clientId,
      redirectUri: callback.redirectUri,
      state,
      codeChallenge,
      resource,
      scope,
    });
    await openAuthorizationUrl(authorizationUrl);

    const params = await callback.result;
    if (params.state !== state) {
      throw new McpOAuthDiscoveryError('OAuth callback state did not match the original request — discarding it');
    }
    // Issuer validation happens BEFORE inspecting error/error_description —
    // per the security-considerations page, a mismatched iss means the
    // whole response (including any error fields) is untrusted.
    const issuerCheck = validateIssuer(
      params.iss,
      issuer,
      asMetadata.authorization_response_iss_parameter_supported ?? false,
    );
    if (!issuerCheck.valid) {
      throw new McpOAuthDiscoveryError(`OAuth callback issuer validation failed: ${issuerCheck.reason}`);
    }
    if (params.error) {
      throw new McpOAuthDiscoveryError(
        `authorization failed: ${params.error}${params.error_description ? ` — ${params.error_description}` : ''}`,
      );
    }
    if (!params.code) {
      throw new McpOAuthDiscoveryError('OAuth callback carried no authorization code');
    }

    const tokens = await exchangeAuthorizationCode({
      tokenEndpoint,
      code: params.code,
      redirectUri: callback.redirectUri,
      clientId: registration.clientId,
      codeVerifier,
      resource,
      ...(registration.clientSecret ? { clientSecret: registration.clientSecret } : {}),
      ...(opts.signal ? { signal: opts.signal } : {}),
    });

    const record: StoredOAuthRecord = {
      serverUrl,
      issuer,
      clientId: registration.clientId,
      tokenEndpoint,
      resource,
      accessToken: tokens.accessToken,
      scope: tokens.scope || scope,
    };
    if (registration.clientSecret) record.clientSecret = registration.clientSecret;
    if (tokens.refreshToken) record.refreshToken = tokens.refreshToken;
    if (tokens.expiresAt !== undefined) record.expiresAt = tokens.expiresAt;

    return { tokens, record };
  } finally {
    callback.close();
  }
}

async function ensureConnected(descriptor: HttpDescriptor, opts: McpOAuthConnectOptions): Promise<McpClient> {
  const stored = await getStoredTokens(descriptor.url);
  if (stored) {
    try {
      return await connectMcpServer(withBearer(descriptor, stored.accessToken), opts);
    } catch (err) {
      if (!(err instanceof McpAuthRequiredError)) throw err;
      const refreshed = await tryRefresh(stored, opts.signal);
      if (refreshed) {
        const updated: StoredOAuthRecord = { ...stored, accessToken: refreshed.accessToken, scope: refreshed.scope || stored.scope };
        if (refreshed.refreshToken) updated.refreshToken = refreshed.refreshToken;
        if (refreshed.expiresAt !== undefined) updated.expiresAt = refreshed.expiresAt;
        await saveStoredTokens(updated);
        return connectMcpServer(withBearer(descriptor, refreshed.accessToken), opts);
      }
      await deleteStoredTokens(descriptor.url); // dead/absent refresh token — cold start below
    }
  }

  // Cold start: attempt an unauthenticated connect first — the server may
  // not require auth at all, and if it does, this is what captures the
  // real WWW-Authenticate challenge (resource_metadata hint + scope).
  let authError: McpAuthRequiredError;
  try {
    return await connectMcpServer(descriptor, opts);
  } catch (err) {
    if (!(err instanceof McpAuthRequiredError)) throw err;
    authError = err;
  }

  if (!opts.interactive) {
    throw new McpInteractiveAuthRequiredError(`${descriptor.url} needs authorization`);
  }
  const challenge = parseBearerChallenge(authError.wwwAuthenticate);
  const result = await runAuthorizationFlow(descriptor.url, {
    ...(challenge?.resource_metadata ? { resourceMetadataHint: challenge.resource_metadata } : {}),
    ...(challenge?.scope ? { scopeHint: challenge.scope } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  await saveStoredTokens(result.record);
  return connectMcpServer(withBearer(descriptor, result.tokens.accessToken), opts);
}

/** Wraps the connected `McpClient` so a mid-session 401 (an access token
 *  expiring naturally) gets one silent refresh-or-reconnect retry via
 *  `ensureConnected`'s own logic, while a 403 `insufficient_scope` is never
 *  auto-retried — it's converted to `McpStepUpRequiredError` and thrown, so
 *  the caller decides whether/when to call `reauthorizeWithStepUp`. */
function createOAuthClient(descriptor: HttpDescriptor, opts: McpOAuthConnectOptions, initial: McpClient): McpClient {
  let current = initial;

  async function withAuthRetry<T>(fn: (client: McpClient) => Promise<T>): Promise<T> {
    try {
      return await fn(current);
    } catch (err) {
      if (!(err instanceof McpAuthRequiredError)) throw err;
      if (err.status === 403) {
        const challenge = parseBearerChallenge(err.wwwAuthenticate);
        const scopes = (challenge?.scope ?? '').split(/\s+/).filter(Boolean);
        throw new McpStepUpRequiredError(err.message, err.wwwAuthenticate, scopes);
      }
      await current.close().catch((err: unknown) => {
        logger('mcp-client').debug('failed to close the stale transport before reconnecting (best-effort cleanup):', err);
      });
      current = await ensureConnected(descriptor, opts);
      return fn(current);
    }
  }

  return {
    get era() {
      return current.era;
    },
    listTools: (signal) => withAuthRetry((c) => c.listTools(signal)),
    callTool: (name, args, signal) => withAuthRetry((c) => c.callTool(name, args, signal)),
    close: () => current.close(),
  };
}

/** The public entry point: connect to a remote MCP server, running the full
 *  OAuth flow (or reusing/refreshing a stored token) as needed. */
export async function connectMcpServerWithOAuth(
  descriptor: HttpDescriptor,
  opts: McpOAuthConnectOptions,
): Promise<McpClient> {
  const initial = await ensureConnected(descriptor, opts);
  return createOAuthClient(descriptor, opts, initial);
}

/**
 * Re-authorize with an expanded scope after a runtime `insufficient_scope`
 * challenge. Never attempts a `refresh_token` grant (OAuth 2.1 §4.3: a
 * refresh's scope can only narrow, never widen) — always runs a fresh
 * `runAuthorizationFlow` with the scope UNION, reusing the existing client
 * registration when the issuer hasn't rotated. Updates the stored record
 * in place rather than creating a new one. Resolves once the token store
 * is updated; the caller re-issues the call that triggered the 403.
 */
export async function reauthorizeWithStepUp(
  serverUrl: string,
  requiredScopes: string[],
  opts: { interactive: boolean; signal?: AbortSignal },
): Promise<void> {
  const stored = await getStoredTokens(serverUrl);
  const union = unionScopes(stored?.scope ?? '', requiredScopes.join(' '));
  recordStepUpAttempt(serverUrl, union);

  if (!opts.interactive) {
    throw new McpInteractiveAuthRequiredError(`${serverUrl} needs step-up authorization for scope: ${union}`);
  }

  const result = await runAuthorizationFlow(serverUrl, {
    scopeHint: union,
    ...(stored ? { existingRecord: stored } : {}),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });
  const record: StoredOAuthRecord = { ...result.record, scope: result.tokens.scope || union };
  await saveStoredTokens(record);
  clearStepUpAttempts(serverUrl, union);
}
