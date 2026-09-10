/**
 * Hand-built OAuth 2.1 fixture (#2030) — no real OAuth-enabled public MCP
 * server exists to test against (same honesty #2029 gave for the modern-era
 * transport), so this stands in for the whole topology: a Resource Server
 * (401/403-gated `/mcp` JSON-RPC endpoint + RFC 9728 PRM at both well-known
 * forms) and an Authorization Server (RFC 8414 metadata, `/register` DCR,
 * `/authorize` that auto-redirects like a browser that already clicked
 * "allow", and a `/token` endpoint that actually verifies PKCE).
 *
 * The RS and AS are deliberately separate `http.createServer` instances on
 * separate ports — the real-world topology this client is built against —
 * rather than one server multiplexing both roles.
 */
import http from 'node:http';
import crypto from 'node:crypto';

export interface OAuthFixtureOptions {
  /** Whether the AS metadata advertises RFC 9207 `iss` support, and whether
   *  `/authorize` echoes an `iss` param on redirect. */
  includeIss?: boolean;
  /** Overrides the `iss` value sent on the callback redirect — for testing
   *  issuer-mismatch rejection. Implies `includeIss`. */
  overrideCallbackIss?: string;
  /** Overrides the `state` value sent on the callback redirect — for testing
   *  state-mismatch rejection. */
  overrideCallbackState?: string;
  /** Extra fields merged into every `/token` success response. */
  tokenResponseOverrides?: Record<string, unknown>;
  /** If set, the RS's `tools/list` 403s with `insufficient_scope` unless the
   *  presented access token's granted scope contains this scope. */
  requiredScope?: string;
}

interface AuthorizeRecord {
  redirectUri: string;
  codeChallenge: string | null;
  resource: string | null;
  scope: string | null;
  clientId: string | null;
}

export interface OAuthFixture {
  resourceServerUrl: string;
  authorizationServerUrl: string;
  authorizeRequests: Array<Record<string, string | null>>;
  tokenRequests: Array<Record<string, string>>;
  registrationRequests: unknown[];
  mcpRequests: Array<{ authorization: string | null; method: string | undefined }>;
  close(): Promise<void>;
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf-8')));
    req.on('error', reject);
  });
}

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address();
      resolve(typeof addr === 'object' && addr ? addr.port : 0);
    });
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

export async function startOAuthFixture(opts: OAuthFixtureOptions = {}): Promise<OAuthFixture> {
  const authorizeRequests: Array<Record<string, string | null>> = [];
  const tokenRequests: Array<Record<string, string>> = [];
  const registrationRequests: unknown[] = [];
  const mcpRequests: Array<{ authorization: string | null; method: string | undefined }> = [];

  const pendingCodes = new Map<string, AuthorizeRecord>();
  const accessTokenScopes = new Map<string, string>();
  const refreshTokens = new Map<string, string>(); // refreshToken -> scope
  let tokenCounter = 0;

  let resourceServerUrl = '';
  let authorizationServerUrl = '';

  // --- Authorization Server ---
  const asServer = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (url.pathname === '/.well-known/oauth-authorization-server') {
        sendJson(res, 200, {
          issuer: authorizationServerUrl,
          authorization_endpoint: `${authorizationServerUrl}/authorize`,
          token_endpoint: `${authorizationServerUrl}/token`,
          registration_endpoint: `${authorizationServerUrl}/register`,
          response_types_supported: ['code'],
          code_challenge_methods_supported: ['S256'],
          authorization_response_iss_parameter_supported: opts.includeIss ?? Boolean(opts.overrideCallbackIss),
        });
        return;
      }

      if (url.pathname === '/register' && req.method === 'POST') {
        const body: unknown = JSON.parse(await readBody(req));
        registrationRequests.push(body);
        sendJson(res, 201, { client_id: 'fixture-dcr-client-id' });
        return;
      }

      if (url.pathname === '/authorize') {
        const params = url.searchParams;
        const record: Record<string, string | null> = {};
        for (const key of [
          'response_type', 'client_id', 'redirect_uri', 'state',
          'code_challenge', 'code_challenge_method', 'resource', 'scope',
        ]) {
          record[key] = params.get(key);
        }
        authorizeRequests.push(record);

        const redirectUri = params.get('redirect_uri');
        if (!redirectUri) {
          res.writeHead(400);
          res.end('missing redirect_uri');
          return;
        }
        const code = `fixture-code-${authorizeRequests.length}`;
        pendingCodes.set(code, {
          redirectUri,
          codeChallenge: params.get('code_challenge'),
          resource: params.get('resource'),
          scope: params.get('scope'),
          clientId: params.get('client_id'),
        });

        const target = new URL(redirectUri);
        target.searchParams.set('code', code);
        target.searchParams.set('state', opts.overrideCallbackState ?? (params.get('state') ?? ''));
        const iss = opts.overrideCallbackIss ?? (opts.includeIss ? authorizationServerUrl : undefined);
        if (iss) target.searchParams.set('iss', iss);
        res.writeHead(302, { Location: target.toString() });
        res.end();
        return;
      }

      if (url.pathname === '/token' && req.method === 'POST') {
        const bodyText = await readBody(req);
        const params = new URLSearchParams(bodyText);
        const record: Record<string, string> = {};
        for (const [k, v] of params) record[k] = v;
        tokenRequests.push(record);

        const grantType = params.get('grant_type');
        if (grantType === 'authorization_code') {
          const code = params.get('code') ?? '';
          const pending = pendingCodes.get(code);
          if (!pending) {
            sendJson(res, 400, { error: 'invalid_grant', error_description: 'unknown or already-used code' });
            return;
          }
          const verifier = params.get('code_verifier') ?? '';
          const expectedChallenge = crypto.createHash('sha256').update(verifier).digest('base64url');
          if (pending.codeChallenge !== expectedChallenge) {
            sendJson(res, 400, { error: 'invalid_grant', error_description: 'code_verifier did not match code_challenge' });
            return;
          }
          if (params.get('redirect_uri') !== pending.redirectUri) {
            sendJson(res, 400, { error: 'invalid_grant', error_description: 'redirect_uri did not match the authorization request' });
            return;
          }
          if (!params.get('resource') || params.get('resource') !== pending.resource) {
            sendJson(res, 400, { error: 'invalid_grant', error_description: 'resource did not match the authorization request' });
            return;
          }
          pendingCodes.delete(code);

          tokenCounter += 1;
          const accessToken = `fixture-access-token-${tokenCounter}`;
          const refreshToken = `fixture-refresh-token-${tokenCounter}`;
          const scope = pending.scope ?? '';
          accessTokenScopes.set(accessToken, scope);
          refreshTokens.set(refreshToken, scope);
          sendJson(res, 200, {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: refreshToken,
            scope,
            ...opts.tokenResponseOverrides,
          });
          return;
        }

        if (grantType === 'refresh_token') {
          const refreshToken = params.get('refresh_token') ?? '';
          const scope = refreshTokens.get(refreshToken);
          if (scope === undefined) {
            sendJson(res, 400, { error: 'invalid_grant', error_description: 'unknown refresh token' });
            return;
          }
          tokenCounter += 1;
          const accessToken = `fixture-access-token-${tokenCounter}`;
          accessTokenScopes.set(accessToken, scope);
          sendJson(res, 200, {
            access_token: accessToken,
            token_type: 'Bearer',
            expires_in: 3600,
            scope,
            ...opts.tokenResponseOverrides,
          });
          return;
        }

        sendJson(res, 400, { error: 'unsupported_grant_type' });
        return;
      }

      res.writeHead(404);
      res.end();
    })();
  });

  const asPort = await listen(asServer);
  authorizationServerUrl = `http://127.0.0.1:${asPort}`;

  // --- Resource Server ---
  const rsServer = http.createServer((req, res) => {
    void (async () => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');

      if (
        url.pathname === '/.well-known/oauth-protected-resource/mcp'
        || url.pathname === '/.well-known/oauth-protected-resource'
      ) {
        sendJson(res, 200, { resource: resourceServerUrl, authorization_servers: [authorizationServerUrl] });
        return;
      }

      if (url.pathname !== '/mcp' || req.method !== 'POST') {
        res.writeHead(404);
        res.end();
        return;
      }

      const authorization = req.headers.authorization ?? null;
      const bodyText = await readBody(req);
      let msg: { id?: unknown; method?: string };
      try {
        msg = JSON.parse(bodyText);
      } catch {
        res.writeHead(400);
        res.end();
        return;
      }
      mcpRequests.push({ authorization, method: msg.method });

      const presentedToken = authorization?.startsWith('Bearer ') ? authorization.slice('Bearer '.length) : null;
      const grantedScope = presentedToken ? accessTokenScopes.get(presentedToken) : undefined;
      if (grantedScope === undefined) {
        res.writeHead(401, {
          'content-type': 'application/json',
          'www-authenticate': `Bearer resource_metadata="${resourceServerUrl.replace(/\/mcp$/, '')}/.well-known/oauth-protected-resource/mcp"`,
        });
        res.end();
        return;
      }

      if (msg.method === 'tools/list' && opts.requiredScope && !grantedScope.split(/\s+/).includes(opts.requiredScope)) {
        res.writeHead(403, {
          'content-type': 'application/json',
          'www-authenticate': `Bearer error="insufficient_scope", scope="${opts.requiredScope}"`,
        });
        res.end();
        return;
      }

      if (msg.method === 'server/discover') {
        sendJson(res, 200, { jsonrpc: '2.0', id: msg.id, result: { resultType: 'complete', supportedVersions: ['2026-07-28'], capabilities: {} } });
        return;
      }
      if (msg.method === 'tools/list') {
        sendJson(res, 200, { jsonrpc: '2.0', id: msg.id, result: { resultType: 'complete', tools: [] } });
        return;
      }
      sendJson(res, 404, { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `unknown method ${String(msg.method)}` } });
    })();
  });

  const rsPort = await listen(rsServer);
  resourceServerUrl = `http://127.0.0.1:${rsPort}/mcp`;

  return {
    resourceServerUrl,
    authorizationServerUrl,
    authorizeRequests,
    tokenRequests,
    registrationRequests,
    mcpRequests,
    close: async () => {
      await Promise.all([
        new Promise<void>((r) => asServer.close(() => r())),
        new Promise<void>((r) => rsServer.close(() => r())),
      ]);
    },
  };
}
