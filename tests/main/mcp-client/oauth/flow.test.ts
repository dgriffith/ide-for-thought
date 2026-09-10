/**
 * End-to-end OAuth 2.1 flow (#2030) against the hand-built fixture AS+RS in
 * `tests/helpers/mcp-oauth-fixture.ts` — no real OAuth-enabled MCP server
 * exists to test against, so this drives the full discovery → registration
 * → PKCE → callback → token-exchange sequence for real over real loopback
 * HTTP sockets. `shell.openExternal` is mocked to `fetch()` the URL directly
 * (following the redirect), simulating "the browser followed the link and
 * landed on the loopback callback."
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { startOAuthFixture, type OAuthFixture } from '../../../helpers/mcp-oauth-fixture';
import {
  McpConnectionError,
  McpInteractiveAuthRequiredError,
  McpOAuthDiscoveryError,
  McpPkceUnsupportedError,
  McpStepUpRequiredError,
} from '../../../../src/main/mcp-client/errors';
import { _resetStepUpAttemptsForTests } from '../../../../src/main/mcp-client/oauth/step-up';

let tempDir: string;

vi.mock('electron', () => ({
  shell: { openExternal: vi.fn(async (url: string) => { await fetch(url); }) },
  app: {
    getPath: (name: string) => {
      if (name !== 'userData') throw new Error(`unexpected getPath(${name})`);
      return tempDir;
    },
  },
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (s: string) => Buffer.from('FAKEENC:' + s, 'utf-8'),
    decryptString: (buf: Buffer) => {
      const s = buf.toString('utf-8');
      if (!s.startsWith('FAKEENC:')) throw new Error('bad ciphertext');
      return s.slice('FAKEENC:'.length);
    },
  },
}));

import { shell } from 'electron';
import { connectMcpServerWithOAuth, runAuthorizationFlow, reauthorizeWithStepUp } from '../../../../src/main/mcp-client/oauth/flow';
import { getStoredTokens, saveStoredTokens } from '../../../../src/main/mcp-client/oauth/token-store';

let fixture: OAuthFixture | null = null;

beforeEach(() => {
  tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-mcp-oauth-flow-'));
  vi.clearAllMocks();
  vi.mocked(shell.openExternal).mockImplementation(async (url: string) => { await fetch(url); });
  _resetStepUpAttemptsForTests();
});

afterEach(async () => {
  fs.rmSync(tempDir, { recursive: true, force: true });
  await fixture?.close();
  fixture = null;
});

describe('runAuthorizationFlow', () => {
  it('drives discovery -> registration -> PKCE -> exchange end to end', async () => {
    fixture = await startOAuthFixture();
    const result = await runAuthorizationFlow(fixture.resourceServerUrl, {});

    expect(result.tokens.accessToken).toBe('fixture-access-token-1');
    expect(result.tokens.refreshToken).toBe('fixture-refresh-token-1');
    expect(result.record.issuer).toBe(fixture.authorizationServerUrl);
    expect(result.record.clientId).toBe('fixture-dcr-client-id');
    expect(result.record.resource).toBe(fixture.resourceServerUrl);

    expect(fixture.registrationRequests).toEqual([
      expect.objectContaining({
        token_endpoint_auth_method: 'none',
        grant_types: ['authorization_code'],
        response_types: ['code'],
        application_type: 'native',
      }),
    ]);
    expect(fixture.authorizeRequests).toHaveLength(1);
    expect(fixture.authorizeRequests[0]).toMatchObject({
      response_type: 'code',
      client_id: 'fixture-dcr-client-id',
      code_challenge_method: 'S256',
      resource: fixture.resourceServerUrl,
    });
    expect(fixture.tokenRequests).toHaveLength(1);
    expect(fixture.tokenRequests[0]).toMatchObject({ grant_type: 'authorization_code' });
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
  });

  it('rejects a callback whose iss does not match the discovered issuer', async () => {
    fixture = await startOAuthFixture({ includeIss: true, overrideCallbackIss: 'https://evil.example.com' });
    await expect(runAuthorizationFlow(fixture.resourceServerUrl, {})).rejects.toThrow(McpOAuthDiscoveryError);
  });

  it('rejects a callback whose state does not match the original request', async () => {
    fixture = await startOAuthFixture({ overrideCallbackState: 'not-the-real-state' });
    await expect(runAuthorizationFlow(fixture.resourceServerUrl, {})).rejects.toThrow(/state did not match/);
  });

  it('dedups two near-simultaneous flows for the same server into one', async () => {
    fixture = await startOAuthFixture();
    const [a, b] = await Promise.all([
      runAuthorizationFlow(fixture.resourceServerUrl, {}),
      runAuthorizationFlow(fixture.resourceServerUrl, {}),
    ]);
    expect(a).toBe(b);
    expect(fixture.authorizeRequests).toHaveLength(1);
    expect(fixture.registrationRequests).toHaveLength(1);
  });

  it('throws McpOAuthDiscoveryError when PRM names an empty authorization server entry', async () => {
    fixture = await startOAuthFixture({ prmOverrides: { authorization_servers: [''] } });
    await expect(runAuthorizationFlow(fixture.resourceServerUrl, {})).rejects.toThrow(/named no authorization_servers/);
  });

  it('throws McpPkceUnsupportedError when the AS does not advertise PKCE support', async () => {
    fixture = await startOAuthFixture({ asMetadataOverrides: { code_challenge_methods_supported: undefined } });
    await expect(runAuthorizationFlow(fixture.resourceServerUrl, {})).rejects.toThrow(McpPkceUnsupportedError);
  });

  it('throws McpOAuthDiscoveryError when AS metadata is missing token_endpoint', async () => {
    fixture = await startOAuthFixture({ asMetadataOverrides: { token_endpoint: undefined } });
    await expect(runAuthorizationFlow(fixture.resourceServerUrl, {})).rejects.toThrow(/missing authorization_endpoint or token_endpoint/);
  });

  it('refuses to open a non-http(s) authorization URL', async () => {
    fixture = await startOAuthFixture({ asMetadataOverrides: { authorization_endpoint: 'ftp://evil.example.com/authorize' } });
    await expect(runAuthorizationFlow(fixture.resourceServerUrl, {})).rejects.toThrow(/refusing to open/);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it("falls back to the server URL when PRM's resource field is empty", async () => {
    fixture = await startOAuthFixture({ prmOverrides: { resource: '' } });
    const result = await runAuthorizationFlow(fixture.resourceServerUrl, {});
    expect(result.record.resource).toBe(fixture.resourceServerUrl);
  });

  it('surfaces the denial error/error_description when the user declines consent', async () => {
    fixture = await startOAuthFixture({ simulateDenial: { error: 'access_denied', error_description: 'user declined' } });
    await expect(runAuthorizationFlow(fixture.resourceServerUrl, {})).rejects.toThrow(/access_denied — user declined/);
  });

  it('rejects a callback with neither a code nor an error', async () => {
    fixture = await startOAuthFixture({ omitCodeNoError: true });
    await expect(runAuthorizationFlow(fixture.resourceServerUrl, {})).rejects.toThrow(/carried no authorization code/);
  });

  it('treats a missing authorization_response_iss_parameter_supported as false, and still succeeds', async () => {
    fixture = await startOAuthFixture({ asMetadataOverrides: { authorization_response_iss_parameter_supported: undefined } });
    const result = await runAuthorizationFlow(fixture.resourceServerUrl, {});
    expect(result.tokens.accessToken).toBeTruthy();
  });

  it('completes normally when given an AbortSignal that never aborts', async () => {
    fixture = await startOAuthFixture();
    const result = await runAuthorizationFlow(fixture.resourceServerUrl, { signal: new AbortController().signal });
    expect(result.tokens.accessToken).toBeTruthy();
  });

  it('reuses an existing client registration (including its secret) when the issuer still matches', async () => {
    fixture = await startOAuthFixture();
    const first = await runAuthorizationFlow(fixture.resourceServerUrl, {});
    expect(fixture.registrationRequests).toHaveLength(1);

    const second = await runAuthorizationFlow(fixture.resourceServerUrl, {
      existingRecord: { ...first.record, clientSecret: 'reused-secret' },
    });
    expect(fixture.registrationRequests).toHaveLength(1); // no new registration
    expect(second.record.clientId).toBe(first.record.clientId);
    expect(second.record.clientSecret).toBe('reused-secret');
    expect(fixture.tokenRequests.at(-1)).toMatchObject({ client_secret: 'reused-secret' });
  });
});

describe('connectMcpServerWithOAuth', () => {
  it('runs a full cold-start flow and stores the resulting token', async () => {
    fixture = await startOAuthFixture();
    const client = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: true });
    await expect(client.listTools()).resolves.toEqual([]);
    await client.close();

    const stored = await getStoredTokens(fixture.resourceServerUrl);
    expect(stored?.accessToken).toBe('fixture-access-token-1');
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
  });

  it('reuses a stored token on a second connect without reopening a browser', async () => {
    fixture = await startOAuthFixture();
    const first = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: true });
    await first.close();
    expect(shell.openExternal).toHaveBeenCalledTimes(1);

    const second = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: false });
    await expect(second.listTools()).resolves.toEqual([]);
    await second.close();
    expect(shell.openExternal).toHaveBeenCalledTimes(1); // still just the one, from the cold start
  });

  it('refreshes a dead access token instead of running a full flow again', async () => {
    fixture = await startOAuthFixture();
    const first = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: true });
    await first.close();
    expect(shell.openExternal).toHaveBeenCalledTimes(1);

    const stored = await getStoredTokens(fixture.resourceServerUrl);
    if (!stored) throw new Error('expected a stored record');
    await saveStoredTokens({ ...stored, accessToken: 'stale-access-token' });

    const second = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: false });
    await expect(second.listTools()).resolves.toEqual([]);
    await second.close();

    expect(shell.openExternal).toHaveBeenCalledTimes(1); // refresh path, no new browser round trip
    const refreshed = await getStoredTokens(fixture.resourceServerUrl);
    expect(refreshed?.accessToken).not.toBe('stale-access-token');
    expect(fixture.tokenRequests.some((r) => r.grant_type === 'refresh_token')).toBe(true);
  });

  it('surfaces insufficient_scope as McpStepUpRequiredError, and reauthorizeWithStepUp grants the wider scope', async () => {
    fixture = await startOAuthFixture({ requiredScope: 'files:write' });
    const client = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: true });
    expect(shell.openExternal).toHaveBeenCalledTimes(1);

    let stepUp: McpStepUpRequiredError;
    try {
      await client.listTools();
      throw new Error('expected listTools to reject with McpStepUpRequiredError');
    } catch (err) {
      if (!(err instanceof McpStepUpRequiredError)) throw err;
      stepUp = err;
    }
    expect(stepUp.requiredScopes).toEqual(['files:write']);
    await client.close();

    await reauthorizeWithStepUp(fixture.resourceServerUrl, stepUp.requiredScopes, { interactive: true });
    expect(shell.openExternal).toHaveBeenCalledTimes(2);
    expect(fixture.registrationRequests).toHaveLength(1); // reused the existing client registration

    const reconnected = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: false });
    await expect(reconnected.listTools()).resolves.toEqual([]);
    await reconnected.close();
    expect(shell.openExternal).toHaveBeenCalledTimes(2); // reused the freshly stored, wider-scope token
  });

  it('throws McpInteractiveAuthRequiredError when non-interactive and no token exists yet', async () => {
    fixture = await startOAuthFixture();
    await expect(
      connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: false }),
    ).rejects.toThrow(McpInteractiveAuthRequiredError);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('rethrows a non-auth connection error when the server is unreachable (cold start, no stored token)', async () => {
    fixture = await startOAuthFixture();
    const resourceServerUrl = fixture.resourceServerUrl;
    await fixture.close();
    await expect(
      connectMcpServerWithOAuth({ kind: 'http', url: resourceServerUrl }, { interactive: true }),
    ).rejects.toThrow(McpConnectionError);
  });

  it('rethrows a non-auth connection error when the server becomes unreachable (stored-token path)', async () => {
    fixture = await startOAuthFixture();
    const client = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: true });
    await client.close();
    const resourceServerUrl = fixture.resourceServerUrl;
    await fixture.close();
    await expect(
      connectMcpServerWithOAuth({ kind: 'http', url: resourceServerUrl }, { interactive: false }),
    ).rejects.toThrow(McpConnectionError);
  });

  it('recovers from a mid-session 401 (not insufficient_scope) by closing and reconnecting', async () => {
    fixture = await startOAuthFixture();
    const client = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: true });
    await expect(client.listTools()).resolves.toEqual([]);
    expect(shell.openExternal).toHaveBeenCalledTimes(1);

    fixture.revokeAccessToken('fixture-access-token-1');
    await expect(client.listTools()).resolves.toEqual([]); // recovers via refresh, not a fresh browser flow
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
    expect(fixture.tokenRequests.some((r) => r.grant_type === 'refresh_token')).toBe(true);
    await client.close();
  });

  it('exposes era and delegates callTool through the same auth-retry wrapper', async () => {
    fixture = await startOAuthFixture();
    const client = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: true });
    expect(client.era).toBe('modern');
    await expect(client.callTool('anything', {})).rejects.toThrow();
    await client.close();
  });

  it('carries a client_secret through a token refresh when the registration issued one', async () => {
    fixture = await startOAuthFixture({ dcrClientSecret: 'shh-secret' });
    const first = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: true });
    await first.close();

    const stored = await getStoredTokens(fixture.resourceServerUrl);
    if (!stored) throw new Error('expected a stored record');
    expect(stored.clientSecret).toBe('shh-secret');
    await saveStoredTokens({ ...stored, accessToken: 'stale-access-token' });

    const second = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: false });
    await expect(second.listTools()).resolves.toEqual([]);
    await second.close();
    expect(fixture.tokenRequests.some((r) => r.grant_type === 'refresh_token' && r.client_secret === 'shh-secret')).toBe(true);
  });

  it('falls through to a full flow when the refresh token itself is dead, discarding the old registration', async () => {
    fixture = await startOAuthFixture();
    const first = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: true });
    await first.close();
    expect(shell.openExternal).toHaveBeenCalledTimes(1);
    expect(fixture.registrationRequests).toHaveLength(1);

    const stored = await getStoredTokens(fixture.resourceServerUrl);
    if (!stored) throw new Error('expected a stored record');
    await saveStoredTokens({ ...stored, accessToken: 'stale-access-token', refreshToken: 'dead-refresh-token' });

    const second = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: true });
    await expect(second.listTools()).resolves.toEqual([]);
    await second.close();

    expect(shell.openExternal).toHaveBeenCalledTimes(2); // refresh failed -> deleted -> ran a fresh full flow
    expect(fixture.registrationRequests).toHaveLength(2); // fresh registration, old creds discarded
  });

  it('never registers a refresh attempt (and runs a full flow instead) when no refresh token was ever issued', async () => {
    fixture = await startOAuthFixture({ tokenResponseOverrides: { refresh_token: undefined } });
    const first = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: true });
    await first.close();
    const stored = await getStoredTokens(fixture.resourceServerUrl);
    expect(stored?.refreshToken).toBeUndefined();
    if (!stored) throw new Error('expected a stored record');
    await saveStoredTokens({ ...stored, accessToken: 'stale-access-token' });

    const second = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: true });
    await expect(second.listTools()).resolves.toEqual([]);
    await second.close();

    expect(shell.openExternal).toHaveBeenCalledTimes(2); // no refresh token to try -> straight to a fresh full flow
    expect(fixture.tokenRequests.some((r) => r.grant_type === 'refresh_token')).toBe(false);
  });

  it('omits expiresAt everywhere when the AS never sends expires_in', async () => {
    fixture = await startOAuthFixture({ tokenResponseOverrides: { expires_in: undefined } });
    const first = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: true });
    await first.close();
    let stored = await getStoredTokens(fixture.resourceServerUrl);
    expect(stored?.expiresAt).toBeUndefined();
    if (!stored) throw new Error('expected a stored record');

    await saveStoredTokens({ ...stored, accessToken: 'stale-access-token' });
    const second = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: false });
    await expect(second.listTools()).resolves.toEqual([]);
    await second.close();

    stored = await getStoredTokens(fixture.resourceServerUrl);
    expect(stored?.expiresAt).toBeUndefined();
  });

  it('rotates the stored refresh token when the refresh response issues a new one', async () => {
    fixture = await startOAuthFixture({ tokenResponseOverrides: { refresh_token: 'rotated-refresh-token' } });
    const first = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: true });
    await first.close();
    const stored = await getStoredTokens(fixture.resourceServerUrl);
    if (!stored) throw new Error('expected a stored record');
    await saveStoredTokens({ ...stored, accessToken: 'stale-access-token' });

    const second = await connectMcpServerWithOAuth({ kind: 'http', url: fixture.resourceServerUrl }, { interactive: false });
    await expect(second.listTools()).resolves.toEqual([]);
    await second.close();

    const refreshed = await getStoredTokens(fixture.resourceServerUrl);
    expect(refreshed?.refreshToken).toBe('rotated-refresh-token');
  });
});

describe('reauthorizeWithStepUp', () => {
  it('throws McpInteractiveAuthRequiredError when non-interactive, even with no prior stored record', async () => {
    fixture = await startOAuthFixture();
    await expect(
      reauthorizeWithStepUp(fixture.resourceServerUrl, ['files:write'], { interactive: false }),
    ).rejects.toThrow(McpInteractiveAuthRequiredError);
    expect(shell.openExternal).not.toHaveBeenCalled();
  });

  it('falls back to the scope union when the token response returns an empty scope', async () => {
    fixture = await startOAuthFixture({ tokenResponseOverrides: { scope: '' } });
    await reauthorizeWithStepUp(fixture.resourceServerUrl, ['files:write'], { interactive: true });
    const stored = await getStoredTokens(fixture.resourceServerUrl);
    expect(stored?.scope).toBe('files:write');
  });
});
