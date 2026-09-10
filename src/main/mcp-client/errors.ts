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

/** The very first request came back 401/403 — distinct from the generic
 *  connection-failed case so a later OAuth issue can catch specifically
 *  this rather than parsing a message string. */
export class McpAuthRequiredError extends McpConnectionError {
  constructor(message: string) {
    super(message);
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
