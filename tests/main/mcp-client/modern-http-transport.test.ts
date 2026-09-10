/**
 * Modern-era (2026-07-28) Streamable HTTP transport (#2029) — mocked
 * `fetch`. Pins exact header mirroring (`Mcp-Name` only for methods with a
 * name/uri param), the `_meta` envelope shape, the MRTR loop end-to-end
 * through `callTool`, and `subscriptions/listen`'s ack-then-dispatch shape.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { ModernHttpTransport } from '../../../src/main/mcp-client/http/modern-http-transport';
import { McpAuthRequiredError, McpProtocolError } from '../../../src/main/mcp-client/errors';
import { jsonResponse, openSseStream } from '../../helpers/mcp-http-mocks';

const URL_ = 'http://localhost:9999/mcp';

function parseBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(init?.body as string);
}
function headers(init?: RequestInit): Record<string, string> {
  return (init?.headers as Record<string, string>) ?? {};
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ModernHttpTransport (#2029)', () => {
  it('connect() is a no-op — no fetch call, era is modern immediately', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const transport = new ModernHttpTransport({ kind: 'http', url: URL_ });
    await transport.connect();
    expect(transport.era).toBe('modern');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('tools/list carries MCP-Protocol-Version + Mcp-Method but no Mcp-Name', async () => {
    let seenHeaders: Record<string, string> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seenHeaders = headers(init);
      const body = parseBody(init);
      return jsonResponse(200, { jsonrpc: '2.0', id: body.id, result: { resultType: 'complete', tools: [] } });
    }));
    const transport = new ModernHttpTransport({ kind: 'http', url: URL_ });
    await transport.listTools();
    expect(seenHeaders['MCP-Protocol-Version']).toBe('2026-07-28');
    expect(seenHeaders['Mcp-Method']).toBe('tools/list');
    expect(seenHeaders['Mcp-Name']).toBeUndefined();
  });

  it('tools/call carries Mcp-Name = the tool name, and the exact _meta field names', async () => {
    let seenHeaders: Record<string, string> = {};
    let seenBody: Record<string, unknown> = {};
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      seenHeaders = headers(init);
      seenBody = parseBody(init);
      return jsonResponse(200, {
        jsonrpc: '2.0', id: seenBody.id,
        result: { resultType: 'complete', content: [{ type: 'text', text: 'ok' }], isError: false },
      });
    }));
    const transport = new ModernHttpTransport({ kind: 'http', url: URL_ });
    await transport.callTool('search', { q: 'x' });

    expect(seenHeaders['Mcp-Name']).toBe('search');
    const params = seenBody.params as Record<string, unknown>;
    expect(params.name).toBe('search');
    expect(params.arguments).toEqual({ q: 'x' });
    const meta = params._meta as Record<string, unknown>;
    expect(meta['io.modelcontextprotocol/protocolVersion']).toBe('2026-07-28');
    expect(meta['io.modelcontextprotocol/clientInfo']).toEqual({ name: 'minerva', version: '1.0.0' });
    expect(meta['io.modelcontextprotocol/clientCapabilities']).toEqual({});
  });

  it('drives an input_required → complete MRTR round-trip through callTool', async () => {
    let call = 0;
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      call += 1;
      const body = parseBody(init);
      if (call === 1) {
        return jsonResponse(200, {
          jsonrpc: '2.0', id: body.id,
          result: {
            resultType: 'input_required',
            inputRequests: { r1: { method: 'roots/list', params: {} } },
            requestState: 'opaque-state',
          },
        });
      }
      const params = body.params as Record<string, unknown>;
      expect(params.inputResponses).toEqual({ r1: { roots: [] } });
      expect(params.requestState).toBe('opaque-state');
      return jsonResponse(200, {
        jsonrpc: '2.0', id: body.id,
        result: { resultType: 'complete', content: [{ type: 'text', text: 'done' }], isError: false },
      });
    }));
    const transport = new ModernHttpTransport({ kind: 'http', url: URL_ });
    const result = await transport.callTool('needs-roots', {});
    expect(result).toEqual({ content: [{ type: 'text', text: 'done' }], isError: false });
    expect(call).toBe(2);
  });

  it('a 400 HeaderMismatch response surfaces as McpProtocolError with the matching code', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = parseBody(init);
      return jsonResponse(400, { jsonrpc: '2.0', id: body.id, error: { code: -32020, message: 'Header mismatch' } });
    }));
    const transport = new ModernHttpTransport({ kind: 'http', url: URL_ });
    await expect(transport.listTools()).rejects.toMatchObject({ constructor: McpProtocolError, code: -32020 });
  });

  it('a 401 response surfaces as McpAuthRequiredError', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
    const transport = new ModernHttpTransport({ kind: 'http', url: URL_ });
    await expect(transport.listTools()).rejects.toBeInstanceOf(McpAuthRequiredError);
  });

  describe('listenForChanges', () => {
    it('verifies the acknowledgment and dispatches subsequent notifications', async () => {
      const stream = openSseStream();
      let seenBody: Record<string, unknown> = {};
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
        seenBody = parseBody(init);
        return stream.response;
      }));
      const transport = new ModernHttpTransport({ kind: 'http', url: URL_ });
      const received: unknown[] = [];

      const ackPromise = transport.listenForChanges({ toolsListChanged: true }, (n) => received.push(n));
      // Push the ack after listenForChanges has issued its request, keyed to the request id it sent.
      await vi.waitFor(() => expect(seenBody.id).toBeDefined());
      stream.push({
        data: {
          jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged',
          params: { _meta: { 'io.modelcontextprotocol/subscriptionId': seenBody.id } },
        },
      });
      const subscription = await ackPromise;
      expect(subscription.subscriptionId).toBe(seenBody.id);

      stream.push({ data: { jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: {} } });
      await vi.waitFor(() => expect(received).toHaveLength(1));
      expect(received[0]).toEqual({ method: 'notifications/tools/list_changed', params: {} });

      subscription.close();
    });

    it('throws when the first frame is not an acknowledgment', async () => {
      const stream = openSseStream();
      vi.stubGlobal('fetch', vi.fn(async () => stream.response));
      stream.push({ data: { jsonrpc: '2.0', method: 'notifications/something/else', params: {} } });
      const transport = new ModernHttpTransport({ kind: 'http', url: URL_ });
      await expect(transport.listenForChanges({}, () => {})).rejects.toThrow(/not an acknowledgment/);
    });

    it('throws McpAuthRequiredError on a 401', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 401 })));
      const transport = new ModernHttpTransport({ kind: 'http', url: URL_ });
      await expect(transport.listenForChanges({}, () => {})).rejects.toBeInstanceOf(McpAuthRequiredError);
    });

    it('throws McpProtocolError on a non-ok, non-auth status', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(null, { status: 500 })));
      const transport = new ModernHttpTransport({ kind: 'http', url: URL_ });
      await expect(transport.listenForChanges({}, () => {})).rejects.toMatchObject({ constructor: McpProtocolError });
    });

    it('throws when the acknowledgment frame is not valid JSON', async () => {
      const stream = openSseStream();
      vi.stubGlobal('fetch', vi.fn(async () => stream.response));
      stream.push({ data: 'not-json-at-all-{{{' });
      const transport = new ModernHttpTransport({ kind: 'http', url: URL_ });
      await expect(transport.listenForChanges({}, () => {})).rejects.toThrow(/not valid JSON/);
    });

    it('throws when the acknowledgment subscriptionId does not match the request id', async () => {
      const stream = openSseStream();
      vi.stubGlobal('fetch', vi.fn(async () => stream.response));
      stream.push({
        data: {
          jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged',
          params: { _meta: { 'io.modelcontextprotocol/subscriptionId': 'wrong-id' } },
        },
      });
      const transport = new ModernHttpTransport({ kind: 'http', url: URL_ });
      await expect(transport.listenForChanges({}, () => {})).rejects.toThrow(/did not match the request id/);
    });

    it('logs and drops a non-JSON frame after the acknowledgment, without ending the subscription', async () => {
      const stream = openSseStream();
      let seenBody: Record<string, unknown> = {};
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
        seenBody = parseBody(init);
        return stream.response;
      }));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const transport = new ModernHttpTransport({ kind: 'http', url: URL_ });
      const received: unknown[] = [];

      const ackPromise = transport.listenForChanges({}, (n) => received.push(n));
      await vi.waitFor(() => expect(seenBody.id).toBeDefined());
      stream.push({
        data: {
          jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged',
          params: { _meta: { 'io.modelcontextprotocol/subscriptionId': seenBody.id } },
        },
      });
      const subscription = await ackPromise;

      stream.push({ data: 'not-json-at-all-{{{' });
      await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('dropped a non-JSON frame'), expect.anything()));

      // The malformed frame didn't end the loop — a good one right after still dispatches.
      stream.push({ data: { jsonrpc: '2.0', method: 'notifications/tools/list_changed', params: {} } });
      await vi.waitFor(() => expect(received).toHaveLength(1));

      subscription.close();
      warnSpy.mockRestore();
    });

    it('logs when the stream ends unexpectedly (not via subscription.close())', async () => {
      const stream = openSseStream();
      let seenBody: Record<string, unknown> = {};
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
        seenBody = parseBody(init);
        return stream.response;
      }));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const transport = new ModernHttpTransport({ kind: 'http', url: URL_ });

      const ackPromise = transport.listenForChanges({}, () => {});
      await vi.waitFor(() => expect(seenBody.id).toBeDefined());
      stream.push({
        data: {
          jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged',
          params: { _meta: { 'io.modelcontextprotocol/subscriptionId': seenBody.id } },
        },
      });
      await ackPromise;

      stream.error(new Error('connection reset'));
      await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('stream ended'), expect.anything()));
      warnSpy.mockRestore();
    });

    it('the background loop exits quietly when the stream closes normally', async () => {
      const stream = openSseStream();
      let seenBody: Record<string, unknown> = {};
      vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
        seenBody = parseBody(init);
        return stream.response;
      }));
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const transport = new ModernHttpTransport({ kind: 'http', url: URL_ });

      const ackPromise = transport.listenForChanges({}, () => {});
      await vi.waitFor(() => expect(seenBody.id).toBeDefined());
      stream.push({
        data: {
          jsonrpc: '2.0', method: 'notifications/subscriptions/acknowledged',
          params: { _meta: { 'io.modelcontextprotocol/subscriptionId': seenBody.id } },
        },
      });
      await ackPromise;

      stream.close(); // a clean end-of-stream, not an error — no reconnect, no warning
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(warnSpy).not.toHaveBeenCalled();
      warnSpy.mockRestore();
    });
  });
});
