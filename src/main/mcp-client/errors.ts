/**
 * MCP client error types (#2029). Per CLAUDE.md's IPC error-handling
 * philosophy applied one layer early — this is a main-process-internal
 * library today, but it will sit directly behind an IPC boundary once a
 * later issue wires it into the renderer, so throwing typed errors now
 * (rather than a generic `Error` or an in-band `{ok:false}` field) means no
 * reshape later: a handler can `instanceof`-branch on `McpAuthRequiredError`
 * to route to the OAuth flow, for example.
 */

/** Base class for every error this module throws. */
export class McpClientError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'McpClientError';
  }
}

/** Connecting to / establishing a session with a server failed — spawn
 *  failure, network error, era-detection exhausted, non-compliant
 *  handshake response. Carries the underlying attempts when era detection
 *  itself is what failed, so the real cause isn't lost. Named `details`
 *  rather than `cause` to avoid colliding with `Error`'s own built-in
 *  `cause` field (different shape/semantics). */
export class McpConnectionError extends McpClientError {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'McpConnectionError';
  }
}

/** A request came back 401/403 — distinct from the generic connection-failed
 *  case so the OAuth flow (#2030) can catch specifically this rather than
 *  parsing a message string. Carries the raw ingredients the discovery
 *  chain needs: `status` distinguishes "needs initial auth" (401) from
 *  "needs step-up" (403 insufficient_scope), and `wwwAuthenticate` is the
 *  raw challenge header (`resource_metadata=`/`scope=`/`error=` params
 *  parsed by `oauth/www-authenticate.ts`, not here — this class just
 *  transports the raw string). */
export class McpAuthRequiredError extends McpConnectionError {
  constructor(message: string, public readonly status: 401 | 403, public readonly wwwAuthenticate: string | null) {
    super(message, { status, wwwAuthenticate });
    this.name = 'McpAuthRequiredError';
  }
}

/** A connected server violated the protocol it claimed to speak — a
 *  malformed response, an SSE stream that never terminates, a mismatched
 *  header, an MRTR loop that never converges. */
export class McpProtocolError extends McpClientError {
  constructor(message: string, public readonly code?: number) {
    super(message);
    this.name = 'McpProtocolError';
  }
}

/** A modern-era `input_required` result named a method (almost always
 *  `sampling/createMessage`) with no injected handler able to answer it.
 *  Thrown rather than fabricated — inventing an LLM completion here would
 *  violate the Trust Principle (CLAUDE.md). */
export class McpInputRequiredUnhandledError extends McpClientError {
  constructor(method: string) {
    super(`No handler for input-required method "${method}" — refusing to fabricate a response`);
    this.name = 'McpInputRequiredUnhandledError';
  }
}

/** #2030's OAuth flow: a non-interactive connect (`interactive: false`)
 *  found no usable/refreshable token — the caller's UI renders this as
 *  "needs reauthorization," never triggers `shell.openExternal` itself. */
export class McpInteractiveAuthRequiredError extends McpClientError {
  constructor(message: string) {
    super(message);
    this.name = 'McpInteractiveAuthRequiredError';
  }
}

/** A connected client's `listTools`/`callTool` got a runtime 403
 *  `insufficient_scope` challenge — carries the scopes the challenge
 *  demanded so the caller can decide whether/when to call
 *  `reauthorizeWithStepUp`. Never auto-retried — popping a browser mid-tool-call
 *  would be the exact surprise `interactive` exists to prevent. */
export class McpStepUpRequiredError extends McpAuthRequiredError {
  constructor(message: string, wwwAuthenticate: string | null, public readonly requiredScopes: string[]) {
    super(message, 403, wwwAuthenticate);
    this.name = 'McpStepUpRequiredError';
  }
}

/** A server has repeatedly challenged for the same (server, scope-union)
 *  pair beyond the retry ceiling — stops a buggy/hostile AS from driving
 *  unbounded reauthorization attempts. */
export class McpStepUpRetryLimitExceededError extends McpClientError {
  constructor(message: string) {
    super(message);
    this.name = 'McpStepUpRetryLimitExceededError';
  }
}

/** Protected Resource Metadata or Authorization Server Metadata discovery
 *  exhausted every fallback without finding a usable document. Carries
 *  which URLs were tried, mirroring `McpConnectionError`'s `details` shape. */
export class McpOAuthDiscoveryError extends McpClientError {
  constructor(message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'McpOAuthDiscoveryError';
  }
}

/** No client registration mechanism worked — no pre-registered client info,
 *  CIMD unavailable/unconfigured, and either no `registration_endpoint` or
 *  DCR itself failed. */
export class McpClientRegistrationFailedError extends McpClientError {
  constructor(message: string) {
    super(message);
    this.name = 'McpClientRegistrationFailedError';
  }
}

/** The authorization server's metadata has no `code_challenge_methods_supported`
 *  — per the spec's security-considerations page, MCP clients MUST refuse
 *  to proceed rather than fall back to a non-PKCE flow. */
export class McpPkceUnsupportedError extends McpClientError {
  constructor(issuer: string) {
    super(`Authorization server "${issuer}" does not advertise PKCE support (code_challenge_methods_supported) — refusing to proceed`);
    this.name = 'McpPkceUnsupportedError';
  }
}
