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
import { McpOAuthDiscoveryError, McpStepUpRequiredError } from '../../../../src/main/mcp-client/errors';

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
});
