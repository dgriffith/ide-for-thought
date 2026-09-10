/**
 * Shared HTTP plumbing for both Streamable HTTP transports (#2029): `_meta`
 * block construction, header building, a timeout/external-signal combinator,
 * and JSON-vs-SSE response-body dispatch for a POST that expects at most one
 * reply. The legacy transport's long-lived GET stream parses its own
 * multi-frame SSE traffic directly with `SseFrameParser` — this file only
 * covers the "one POST, at most one JSON-RPC reply" shape both eras share.
 */
import { logger } from '../../../shared/logger';
import { McpAuthRequiredError, McpConnectionError, McpProtocolError } from '../errors';
import { isJsonRpcResponse, type JsonRpcResponse } from '../json-rpc';
import { CLIENT_INFO } from '../types';
import { MODERN_PROTOCOL_VERSION } from '../era';
import { SseFrameParser, type SseFrame } from './sse-parser';

export function modernMeta(): Record<string, unknown> {
  return {
    'io.modelcontextprotocol/protocolVersion': MODERN_PROTOCOL_VERSION,
    'io.modelcontextprotocol/clientInfo': CLIENT_INFO,
    'io.modelcontextprotocol/clientCapabilities': {},
  };
}

/** Methods whose params carry the field the modern spec mirrors into
 *  `Mcp-Name` — `server/discover`, `tools/list`, and `subscriptions/listen`
 *  have no `name`/`uri` param and get no header. */
const NAME_BEARING_METHOD_FIELDS: Record<string, string> = {
  'tools/call': 'name',
  'resources/read': 'uri',
  'prompts/get': 'name',
};

/** Headers for a modern-era request. `Mcp-Name` is added only for the
 *  methods listed above, and only when the field is actually a string. */
export function modernHeaders(method: string, params: Record<string, unknown>): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
    'MCP-Protocol-Version': MODERN_PROTOCOL_VERSION,
    'Mcp-Method': method,
  };
  const nameField = NAME_BEARING_METHOD_FIELDS[method];
  const nameValue = nameField ? params[nameField] : undefined;
  if (typeof nameValue === 'string') headers['Mcp-Name'] = nameValue;
  return headers;
}

/** Headers for a legacy-era request — no `_meta`/protocol-version mirroring;
 *  the session id (once known) is the only thing legacy requests carry
 *  beyond a plain JSON-RPC POST. */
export function legacyHeaders(sessionId?: string): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json, text/event-stream',
  };
  if (sessionId) headers['Mcp-Session-Id'] = sessionId;
  return headers;
}

/** Combine an optional external `AbortSignal` with a timeout into one
 *  signal, so a caller doesn't have to hand-wire `setTimeout`+listener
 *  cleanup at every call site. */
export function timeoutSignal(ms: number, external?: AbortSignal): AbortSignal {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error(`timed out after ${ms}ms`)), ms);
  const clear = () => clearTimeout(timer);
  controller.signal.addEventListener('abort', clear, { once: true });
  external?.addEventListener(
    'abort',
    () => {
      clear();
      controller.abort(external.reason);
    },
    { once: true },
  );
  return controller.signal;
}

export interface PostJsonRpcResult {
  /** `null` when the body was empty/unparseable but the HTTP status was
   *  otherwise successful (e.g. a `202 Accepted` notification ack). */
  response: JsonRpcResponse | null;
  httpResponse: Response;
}

/**
 * POST one JSON-RPC message and read back at most one reply — the shape
 * every request/response call (as opposed to the legacy GET stream) needs
 * on both eras. Throws `McpAuthRequiredError` on 401/403 and
 * `McpConnectionError` when the HTTP status was an error AND the body
 * didn't parse as a JSON-RPC response (a well-formed JSON-RPC error body on
 * a 400 — the modern era's documented shape for `HeaderMismatch` etc. — is
 * NOT an exception here; the caller reads `.response.error` itself).
 */
export async function postJsonRpc(
  url: string,
  body: Record<string, unknown>,
  headers: Record<string, string>,
  opts: { signal?: AbortSignal; expectedId?: string | number } = {},
): Promise<PostJsonRpcResult> {
  const httpResponse = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    ...(opts.signal ? { signal: opts.signal } : {}),
  });

  if (httpResponse.status === 401 || httpResponse.status === 403) {
    throw new McpAuthRequiredError(
      `server returned ${httpResponse.status} — authorization required`,
      httpResponse.status,
      httpResponse.headers.get('www-authenticate'),
    );
  }
  if (httpResponse.status === 202) {
    return { response: null, httpResponse };
  }

  const contentType = httpResponse.headers.get('content-type') ?? '';
  let response: JsonRpcResponse | null;
  if (contentType.includes('text/event-stream')) {
    response = await parseSingleSseResponse(httpResponse, opts.expectedId);
  } else {
    const text = await httpResponse.text();
    response = text.trim() ? parseJsonRpcResponseBody(text) : null;
  }

  if (!response && !httpResponse.ok) {
    throw new McpConnectionError(`server returned HTTP ${httpResponse.status} with no parseable JSON-RPC body`);
  }
  return { response, httpResponse };
}

/** Throws rather than returning null on a malformed/wrong-shape body — a
 *  non-empty body that isn't a valid JSON-RPC response is a genuine
 *  protocol violation, not "no response" (the empty-body case is handled
 *  separately, before this is called). The era probe's own catch already
 *  treats ANY thrown error as "try legacy next," so this doesn't regress
 *  era detection — it just gives a specific reason instead of a silent null. */
function parseJsonRpcResponseBody(text: string): JsonRpcResponse {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    throw new McpProtocolError(`response body was not valid JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!isJsonRpcResponse(parsed)) {
    throw new McpProtocolError('response body was valid JSON but not a JSON-RPC response');
  }
  return parsed;
}

/** Read an SSE response body, taking the first frame whose `data` parses as
 *  a JSON-RPC response (matching `expectedId` when given), then stop
 *  reading — closing the stream once we have our answer is fine even if the
 *  server would have sent more (progress notifications, keep-alives). */
async function parseSingleSseResponse(
  httpResponse: Response,
  expectedId: string | number | undefined,
): Promise<JsonRpcResponse | null> {
  const reader = httpResponse.body?.getReader();
  if (!reader) return null;
  const parser = new SseFrameParser();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      for (const frame of parser.push(value)) {
        const candidate = tryParseFrame(frame);
        if (candidate && (expectedId === undefined || candidate.id === expectedId)) return candidate;
      }
    }
    for (const frame of parser.flush()) {
      const candidate = tryParseFrame(frame);
      if (candidate) return candidate;
    }
    return null;
  } finally {
    // Best-effort cleanup — we already have (or gave up on) our answer, so a
    // failed cancel isn't actionable, but it's still logged rather than
    // silently discarded.
    await reader.cancel().catch((err: unknown) => {
      logger('mcp-client').debug('SSE reader cancel failed (best-effort cleanup):', err);
    });
  }
}

/**
 * Turns a fetch response body's reader + a fresh `SseFrameParser` into a
 * simple pull-one-frame-at-a-time interface, queuing any extra frames a
 * single chunk produced rather than dropping them. Used where a caller
 * needs to inspect one frame (an acknowledgment) before deciding how to
 * consume the rest of the stream — `subscriptions/listen`'s ack-then-dispatch
 * shape, chiefly.
 */
export class SseFrameReader {
  private readonly queue: SseFrame[] = [];
  private readonly parser = new SseFrameParser();

  constructor(private readonly reader: ReadableStreamDefaultReader<Uint8Array>) {}

  async next(): Promise<SseFrame | null> {
    while (this.queue.length === 0) {
      const { done, value } = await this.reader.read();
      if (done) {
        this.queue.push(...this.parser.flush());
        break;
      }
      this.queue.push(...this.parser.push(value));
    }
    return this.queue.length > 0 ? this.queue.shift()! : null;
  }
}

function tryParseFrame(frame: SseFrame): JsonRpcResponse | null {
  if (!frame.data) return null;
  try {
    const parsed: unknown = JSON.parse(frame.data);
    return isJsonRpcResponse(parsed) ? parsed : null;
  } catch {
    throw new McpProtocolError('SSE frame data was not valid JSON');
  }
}
