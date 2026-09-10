/**
 * Legacy-era Streamable HTTP transport (#2029) — session id via
 * `Mcp-Session-Id`, single-response SSE framing, and the standalone GET
 * stream (with `Last-Event-ID` resumability) for server-initiated messages.
 * Verified against a real reference server
 * (`npx @modelcontextprotocol/server-everything streamableHttp`): its
 * `initialize` response carries `mcp-session-id` and a `text/event-stream`
 * body framed `event: message\nid: <uuid>\ndata: {...}\n\n`.
 */
import { logger } from '../../../shared/logger';
import { McpConnectionError, McpProtocolError } from '../errors';
import { isJsonRpcNotification, isJsonRpcRequest, RequestIdSequence, type JsonRpcSuccess } from '../json-rpc';
import { LEGACY_PROTOCOL_VERSION } from '../era';
import {
  CLIENT_INFO,
  type McpContentBlock,
  type McpEra,
  type McpServerDescriptor,
  type McpToolCallResult,
  type McpToolDescriptor,
  type McpTransport,
} from '../types';
import { legacyHeaders, postJsonRpc, timeoutSignal } from './http-common';
import { SseFrameParser, type SseFrame } from './sse-parser';

type HttpDescriptor = Extract<McpServerDescriptor, { kind: 'http' }>;

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
/** Exponential backoff schedule for a dropped GET stream: 500ms, 1s, 2s,
 *  4s, 8s, then give up — the POST channel (listTools/callTool) is
 *  unaffected by the GET stream's health either way. */
const GET_STREAM_MAX_ATTEMPTS = 5;

export class LegacyHttpTransport implements McpTransport {
  private sessionId: string | null = null;
  private readonly ids = new RequestIdSequence();
  private getStreamController: AbortController | null = null;
  private lastEventId: string | undefined;
  private closed = false;

  constructor(private readonly descriptor: HttpDescriptor) {}

  get era(): McpEra {
    return 'legacy';
  }

  private get extraHeaders(): Record<string, string> {
    return this.descriptor.headers ?? {};
  }

  async connect(signal?: AbortSignal): Promise<void> {
    const id = this.ids.nextId();
    const { response, httpResponse } = await postJsonRpc(
      this.descriptor.url,
      {
        jsonrpc: '2.0',
        id,
        method: 'initialize',
        params: { protocolVersion: LEGACY_PROTOCOL_VERSION, capabilities: {}, clientInfo: CLIENT_INFO },
      },
      { ...legacyHeaders(), ...this.extraHeaders },
      { ...(signal ? { signal } : {}), expectedId: id },
    );
    if (!response) throw new McpConnectionError('legacy initialize returned no response body');
    if ('error' in response) throw new McpConnectionError(`legacy initialize failed: ${response.error.message}`);

    const sessionId = httpResponse.headers.get('mcp-session-id');
    if (!sessionId) {
      throw new McpConnectionError('legacy initialize succeeded without a session id — non-compliant server');
    }
    this.sessionId = sessionId;

    await postJsonRpc(
      this.descriptor.url,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { ...legacyHeaders(sessionId), ...this.extraHeaders },
      signal ? { signal } : {},
    );

    void this.runGetStream(0);
  }

  private async runGetStream(attempt: number): Promise<void> {
    if (this.closed || !this.sessionId) return;
    const controller = new AbortController();
    this.getStreamController = controller;
    try {
      const headers: Record<string, string> = {
        Accept: 'text/event-stream',
        'Mcp-Session-Id': this.sessionId,
        ...this.extraHeaders,
      };
      if (this.lastEventId) headers['Last-Event-ID'] = this.lastEventId;
      const res = await fetch(this.descriptor.url, { method: 'GET', headers, signal: controller.signal });
      if (!res.ok || !res.body) throw new McpConnectionError(`GET stream returned HTTP ${res.status}`);

      const reader = res.body.getReader();
      const parser = new SseFrameParser();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        for (const frame of parser.push(value)) {
          if (frame.id) this.lastEventId = frame.id;
          this.handleGetStreamFrame(frame);
        }
      }
      // Stream ended cleanly (server closed it) — reconnect like a drop,
      // resuming from the last event id, unless we intentionally closed.
      if (!this.closed) void this.runGetStream(0);
    } catch (err) {
      if (this.closed || controller.signal.aborted) return;
      if (attempt >= GET_STREAM_MAX_ATTEMPTS - 1) {
        logger('mcp-client').warn('legacy GET stream reconnect attempts exhausted, giving up:', err);
        return;
      }
      const delayMs = 500 * 2 ** attempt;
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      if (!this.closed) void this.runGetStream(attempt + 1);
    }
  }

  private handleGetStreamFrame(frame: SseFrame): void {
    if (!frame.data) return;
    let msg: unknown;
    try {
      msg = JSON.parse(frame.data);
    } catch {
      logger('mcp-client').warn('GET stream frame was not valid JSON:', frame.data);
      return;
    }
    if (isJsonRpcRequest(msg)) {
      void this.answerServerRequest(msg.id, msg.method);
      return;
    }
    if (isJsonRpcNotification(msg)) {
      logger('mcp-client').debug('unhandled server-initiated notification:', msg.method);
    }
  }

  /** A legacy server-initiated request (e.g. `sampling/createMessage`,
   *  `roots/list`) arriving on the GET stream — answered honestly rather
   *  than left hanging; real dispatch into domain UI is a later issue. */
  private async answerServerRequest(id: string | number, method: string): Promise<void> {
    if (!this.sessionId) return;
    const body =
      method === 'roots/list'
        ? { jsonrpc: '2.0', id, result: { roots: [] } }
        : { jsonrpc: '2.0', id, error: { code: -32601, message: `Client does not support ${method} (mcp-client v1)` } };
    try {
      await postJsonRpc(this.descriptor.url, body, { ...legacyHeaders(this.sessionId), ...this.extraHeaders });
    } catch (err) {
      logger('mcp-client').warn('failed to answer server-initiated request:', err);
    }
  }

  private async request(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonRpcSuccess> {
    if (this.closed) throw new McpConnectionError('mcp transport is not connected');
    const id = this.ids.nextId();
    const { response } = await postJsonRpc(
      this.descriptor.url,
      { jsonrpc: '2.0', id, method, params },
      { ...legacyHeaders(this.sessionId ?? undefined), ...this.extraHeaders },
      { signal: timeoutSignal(DEFAULT_REQUEST_TIMEOUT_MS, signal), expectedId: id },
    );
    if (!response) throw new McpProtocolError(`no response for "${method}"`);
    if ('error' in response) throw new McpProtocolError(response.error.message, response.error.code);
    return response;
  }

  async listTools(signal?: AbortSignal): Promise<McpToolDescriptor[]> {
    const response = await this.request('tools/list', {}, signal);
    const tools = response.result.tools;
    return Array.isArray(tools) ? (tools as McpToolDescriptor[]) : [];
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolCallResult> {
    const response = await this.request('tools/call', { name, arguments: args }, signal);
    const content = Array.isArray(response.result.content) ? (response.result.content as McpContentBlock[]) : [];
    return { content, isError: response.result.isError === true };
  }

  async close(): Promise<void> {
    this.closed = true;
    this.getStreamController?.abort();
    if (this.sessionId) {
      try {
        await fetch(this.descriptor.url, {
          method: 'DELETE',
          headers: { 'Mcp-Session-Id': this.sessionId, ...this.extraHeaders },
        });
      } catch (err) {
        logger('mcp-client').debug('legacy session DELETE failed (best-effort):', err);
      }
    }
  }
}
