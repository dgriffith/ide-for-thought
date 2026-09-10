/**
 * Modern-era (2026-07-28) Streamable HTTP transport (#2029) — stateless: no
 * session, no persistent GET stream (both removed from the spec). Every
 * request self-describes via `_meta` + header mirroring
 * (`MCP-Protocol-Version`/`Mcp-Method`/`Mcp-Name`), and server-initiated
 * input requests arrive embedded in a response (`resultType: 'input_required'`)
 * rather than as an independent call — resolved via the shared MRTR loop
 * (`../mrtr.ts`), so the same logic drives this transport and a modern
 * stdio server's `tools/call`.
 *
 * No real server speaks this era yet — this is exercised against a
 * hand-built fixture (`tests/helpers/mcp-modern-fixture.ts`) until one exists.
 */
import { logger } from '../../../shared/logger';
import { McpAuthRequiredError, McpConnectionError, McpProtocolError } from '../errors';
import { isJsonRpcNotification, RequestIdSequence, type JsonRpcSuccess } from '../json-rpc';
import { defaultInputRequiredHandler, resolveMrtr, type ModernResult } from '../mrtr';
import {
  type InputRequiredHandler,
  type McpContentBlock,
  type McpEra,
  type McpNotification,
  type McpServerDescriptor,
  type McpSubscription,
  type McpSubscriptionFilter,
  type McpToolCallResult,
  type McpToolDescriptor,
  type McpTransport,
} from '../types';
import { modernHeaders, modernMeta, postJsonRpc, SseFrameReader, timeoutSignal } from './http-common';

type HttpDescriptor = Extract<McpServerDescriptor, { kind: 'http' }>;

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;
const SUBSCRIPTION_ID_META_KEY = 'io.modelcontextprotocol/subscriptionId';

export class ModernHttpTransport implements McpTransport {
  private readonly ids = new RequestIdSequence();
  private closed = false;

  constructor(
    private readonly descriptor: HttpDescriptor,
    private readonly inputRequiredHandler: InputRequiredHandler = defaultInputRequiredHandler,
  ) {}

  get era(): McpEra {
    return 'modern';
  }

  private get extraHeaders(): Record<string, string> {
    return this.descriptor.headers ?? {};
  }

  /** No handshake in the modern era — era was already confirmed by the
   *  `server/discover` probe in `client.ts` before this transport was
   *  constructed. Kept as a real async method for interface symmetry (and
   *  so a future issue adding real capability negotiation has a home for it). */
  connect(_signal?: AbortSignal): Promise<void> {
    void _signal;
    return Promise.resolve();
  }

  private async postRequest(
    method: string,
    params: Record<string, unknown>,
    signal?: AbortSignal,
  ): Promise<JsonRpcSuccess> {
    if (this.closed) throw new McpConnectionError('mcp transport is not connected');
    const id = this.ids.nextId();
    const fullParams = { ...params, _meta: modernMeta() };
    const headers = { ...modernHeaders(method, params), ...this.extraHeaders };
    const { response } = await postJsonRpc(
      this.descriptor.url,
      { jsonrpc: '2.0', id, method, params: fullParams },
      headers,
      { signal: timeoutSignal(DEFAULT_REQUEST_TIMEOUT_MS, signal), expectedId: id },
    );
    if (!response) throw new McpProtocolError(`no response for "${method}"`);
    if ('error' in response) throw new McpProtocolError(response.error.message, response.error.code);
    return response;
  }

  async listTools(signal?: AbortSignal): Promise<McpToolDescriptor[]> {
    const response = await this.postRequest('tools/list', {}, signal);
    const tools = response.result.tools;
    return Array.isArray(tools) ? (tools as McpToolDescriptor[]) : [];
  }

  async callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolCallResult> {
    const doCall = async (extra?: Record<string, unknown>): Promise<ModernResult> => {
      const response = await this.postRequest('tools/call', { name, arguments: args, ...extra }, signal);
      return response.result;
    };
    let result = await doCall();
    result = await resolveMrtr(
      result,
      (inputResponses, requestState) =>
        doCall({ inputResponses, ...(requestState !== undefined ? { requestState } : {}) }),
      this.inputRequiredHandler,
    );
    const content = Array.isArray(result.content) ? (result.content as McpContentBlock[]) : [];
    return { content, isError: result.isError === true };
  }

  async listenForChanges(
    filter: McpSubscriptionFilter,
    onNotification: (n: McpNotification) => void,
    signal?: AbortSignal,
  ): Promise<McpSubscription> {
    if (this.closed) throw new McpConnectionError('mcp transport is not connected');
    const id = this.ids.nextId();
    const method = 'subscriptions/listen';
    const params = { notifications: filter, _meta: modernMeta() };
    const headers = { ...modernHeaders(method, {}), ...this.extraHeaders };
    const controller = new AbortController();
    signal?.addEventListener('abort', () => controller.abort(signal.reason), { once: true });

    const httpResponse = await fetch(this.descriptor.url, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      signal: controller.signal,
    });
    if (httpResponse.status === 401 || httpResponse.status === 403) {
      throw new McpAuthRequiredError(`server returned ${httpResponse.status} — authorization required`);
    }
    if (!httpResponse.ok || !httpResponse.body) {
      throw new McpProtocolError(`subscriptions/listen returned HTTP ${httpResponse.status}`);
    }

    const frameReader = new SseFrameReader(httpResponse.body.getReader());
    const firstFrame = await frameReader.next();
    if (!firstFrame) throw new McpProtocolError('subscriptions/listen stream closed before acknowledgment');
    let ack: unknown;
    try {
      ack = JSON.parse(firstFrame.data);
    } catch (err) {
      throw new McpProtocolError(
        `subscriptions/listen: acknowledgment frame was not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    if (!isJsonRpcNotification(ack) || ack.method !== 'notifications/subscriptions/acknowledged') {
      throw new McpProtocolError('subscriptions/listen: first frame was not an acknowledgment');
    }
    const ackSubscriptionId = (ack.params?._meta as Record<string, unknown> | undefined)?.[SUBSCRIPTION_ID_META_KEY];
    if (ackSubscriptionId !== id) {
      throw new McpProtocolError('subscriptions/listen: acknowledgment subscriptionId did not match the request id');
    }

    void (async () => {
      try {
        for (;;) {
          const frame = await frameReader.next();
          if (!frame) break;
          let msg: unknown;
          try {
            msg = JSON.parse(frame.data);
          } catch (err) {
            logger('mcp-client').warn('subscriptions/listen: dropped a non-JSON frame:', err);
            continue;
          }
          if (isJsonRpcNotification(msg)) onNotification({ method: msg.method, params: msg.params ?? {} });
        }
      } catch (err) {
        if (!controller.signal.aborted) logger('mcp-client').warn('subscriptions/listen stream ended:', err);
      }
    })();

    return {
      subscriptionId: ackSubscriptionId as string | number,
      close: () => controller.abort(),
    };
  }

  close(): Promise<void> {
    this.closed = true;
    return Promise.resolve();
  }
}
