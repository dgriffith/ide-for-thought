/**
 * Legacy-era Streamable HTTP transport (#2029) — mocked `fetch`. Pins:
 * session id captured from the `initialize` response header and echoed on
 * every subsequent call, single-response SSE parsed correctly, the GET
 * stream answers a server-initiated request rather than hanging it, and a
 * dropped GET stream reconnects with `Last-Event-ID`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { LegacyHttpTransport } from '../../../src/main/mcp-client/http/legacy-http-transport';
import { jsonResponse, sseResponse, emptyResponse, openSseStream } from '../../helpers/mcp-http-mocks';

const URL_ = 'http://localhost:9999/mcp';
const SESSION_ID = 'session-abc-123';

function parseBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(init?.body as string);
}
function headerValue(init: RequestInit | undefined, name: string): string | undefined {
  const headers = init?.headers as Record<string, string> | undefined;
  return headers?.[name];
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('LegacyHttpTransport (#2029)', () => {
  it('connects: initialize captures the session id, notifications/initialized is sent, GET stream opens', async () => {
    const getStream = openSseStream();
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return getStream.response;
      const body = parseBody(init);
      if (body.method === 'initialize') {
        return sseResponse(200, [{ event: 'message', id: 'e1', data: { jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-06-18' } } }], { 'mcp-session-id': SESSION_ID });
      }
      if (body.method === 'notifications/initialized') return emptyResponse(202);
      return jsonResponse(404, { error: 'unexpected' });
    });
    vi.stubGlobal('fetch', fetchMock);

    const transport = new LegacyHttpTransport({ kind: 'http', url: URL_ });
    await transport.connect();
    expect(transport.era).toBe('legacy');

    const getCall = fetchMock.mock.calls.find(([, init]) => (init as RequestInit)?.method === 'GET');
    expect(getCall).toBeTruthy();
    expect(headerValue(getCall![1] as RequestInit, 'Mcp-Session-Id')).toBe(SESSION_ID);
    await transport.close();
  });

  it('throws when initialize returns no response body at all', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => emptyResponse(200)));
    const transport = new LegacyHttpTransport({ kind: 'http', url: URL_ });
    await expect(transport.connect()).rejects.toThrow(/no response body/);
  });

  it('throws when initialize succeeds without a session id', async () => {
    vi.stubGlobal('fetch', vi.fn(async () =>
      jsonResponse(200, { jsonrpc: '2.0', id: 1, result: {} }),
    ));
    const transport = new LegacyHttpTransport({ kind: 'http', url: URL_ });
    await expect(transport.connect()).rejects.toThrow(/without a session id/);
  });

  it('echoes the session id on listTools/callTool', async () => {
    const getStream = openSseStream();
    const seenSessionHeaders: (string | undefined)[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return getStream.response;
      const body = parseBody(init);
      seenSessionHeaders.push(headerValue(init, 'Mcp-Session-Id'));
      if (body.method === 'initialize') return jsonResponse(200, { jsonrpc: '2.0', id: body.id, result: {} }, { 'mcp-session-id': SESSION_ID });
      if (body.method === 'notifications/initialized') return emptyResponse(202);
      if (body.method === 'tools/list') return jsonResponse(200, { jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object' } }] } });
      if (body.method === 'tools/call') return jsonResponse(200, { jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: 'hi' }], isError: false } });
      return jsonResponse(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    const transport = new LegacyHttpTransport({ kind: 'http', url: URL_ });
    await transport.connect();
    const tools = await transport.listTools();
    expect(tools).toEqual([{ name: 'echo', inputSchema: { type: 'object' } }]);
    const result = await transport.callTool('echo', {});
    expect(result).toEqual({ content: [{ type: 'text', text: 'hi' }], isError: false });

    // initialize has no session id yet; every call after does.
    expect(seenSessionHeaders).toEqual([undefined, SESSION_ID, SESSION_ID, SESSION_ID]);
    await transport.close();
  });

  it('answers a server-initiated roots/list request on the GET stream', async () => {
    const getStream = openSseStream();
    const answered: Record<string, unknown>[] = [];
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return getStream.response;
      const body = parseBody(init);
      if (body.method === 'initialize') return jsonResponse(200, { jsonrpc: '2.0', id: body.id, result: {} }, { 'mcp-session-id': SESSION_ID });
      if (body.method === 'notifications/initialized') return emptyResponse(202);
      if (body.id !== undefined && body.method === undefined) {
        // this is the client's ANSWER to the server-initiated request
        answered.push(body);
        return emptyResponse(202);
      }
      return jsonResponse(404, {});
    });
    vi.stubGlobal('fetch', fetchMock);

    const transport = new LegacyHttpTransport({ kind: 'http', url: URL_ });
    await transport.connect();
    getStream.push({ event: 'message', data: { jsonrpc: '2.0', id: 'srv-1', method: 'roots/list' } });
    await vi.waitFor(() => expect(answered).toHaveLength(1));
    expect(answered[0]).toMatchObject({ id: 'srv-1', result: { roots: [] } });
    await transport.close();
  });

  it('reconnects the GET stream with Last-Event-ID after it drops', async () => {
    const getStream1 = openSseStream();
    let secondGetHeaders: Record<string, string> | undefined;
    let getCallCount = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        getCallCount += 1;
        if (getCallCount === 1) return getStream1.response;
        secondGetHeaders = init?.headers as Record<string, string>;
        return openSseStream().response; // second stream just stays open
      }
      const body = parseBody(init);
      if (body.method === 'initialize') return jsonResponse(200, { jsonrpc: '2.0', id: body.id, result: {} }, { 'mcp-session-id': SESSION_ID });
      return emptyResponse(202);
    });
    vi.stubGlobal('fetch', fetchMock);

    const transport = new LegacyHttpTransport({ kind: 'http', url: URL_ });
    await transport.connect();
    getStream1.push({ event: 'message', id: 'evt-1', data: { jsonrpc: '2.0', method: 'notifications/x', params: {} } });
    getStream1.error(new Error('stream dropped'));

    await vi.waitFor(() => expect(getCallCount).toBe(2), { timeout: 2000 });
    expect(secondGetHeaders?.['Last-Event-ID']).toBe('evt-1');
    await transport.close();
  });

  it('logs and drops a non-JSON GET-stream frame without crashing', async () => {
    const getStream = openSseStream();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return getStream.response;
      const body = parseBody(init);
      if (body.method === 'initialize') return jsonResponse(200, { jsonrpc: '2.0', id: body.id, result: {} }, { 'mcp-session-id': SESSION_ID });
      return emptyResponse(202);
    });
    vi.stubGlobal('fetch', fetchMock);

    const transport = new LegacyHttpTransport({ kind: 'http', url: URL_ });
    await transport.connect();
    getStream.push({ event: 'message', data: 'not-json-at-all-{{{' });
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('not valid JSON'), expect.anything()));
    await transport.close();
    warnSpy.mockRestore();
  });

  it('logs when answering a server-initiated request itself fails', async () => {
    const getStream = openSseStream();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return getStream.response;
      const body = parseBody(init);
      if (body.method === 'initialize') return jsonResponse(200, { jsonrpc: '2.0', id: body.id, result: {} }, { 'mcp-session-id': SESSION_ID });
      if (body.id !== undefined && body.method === undefined) {
        throw new TypeError('network down'); // the answer POST itself fails
      }
      return emptyResponse(202);
    });
    vi.stubGlobal('fetch', fetchMock);

    const transport = new LegacyHttpTransport({ kind: 'http', url: URL_ });
    await transport.connect();
    getStream.push({ event: 'message', data: { jsonrpc: '2.0', id: 'srv-1', method: 'roots/list' } });
    await vi.waitFor(() => expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('failed to answer'), expect.anything()));
    await transport.close();
    warnSpy.mockRestore();
  });

  it('logs and gives up after exhausting GET-stream reconnect attempts', async () => {
    vi.useFakeTimers();
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
        const method = init?.method ?? 'GET';
        if (method === 'GET') return new Response(null, { status: 500 });
        const body = parseBody(init);
        if (body.method === 'initialize') return jsonResponse(200, { jsonrpc: '2.0', id: body.id, result: {} }, { 'mcp-session-id': SESSION_ID });
        return emptyResponse(202);
      });
      vi.stubGlobal('fetch', fetchMock);

      const transport = new LegacyHttpTransport({ kind: 'http', url: URL_ });
      await transport.connect();
      await vi.advanceTimersByTimeAsync(10_000);

      const getCalls = fetchMock.mock.calls.filter(([, init]) => (init as RequestInit)?.method === 'GET');
      expect(getCalls.length).toBe(5); // initial attempt + 4 retries, per the 500/1000/2000/4000ms backoff
      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('reconnect attempts exhausted'), expect.anything());
      await transport.close();
    } finally {
      vi.useRealTimers();
      warnSpy.mockRestore();
    }
  });

  it('reconnects when the GET stream ends cleanly (not an error)', async () => {
    const getStream1 = openSseStream();
    let getCallCount = 0;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') {
        getCallCount += 1;
        if (getCallCount === 1) return getStream1.response;
        return openSseStream().response;
      }
      const body = parseBody(init);
      if (body.method === 'initialize') return jsonResponse(200, { jsonrpc: '2.0', id: body.id, result: {} }, { 'mcp-session-id': SESSION_ID });
      return emptyResponse(202);
    });
    vi.stubGlobal('fetch', fetchMock);

    const transport = new LegacyHttpTransport({ kind: 'http', url: URL_ });
    await transport.connect();
    getStream1.close(); // clean end-of-stream, not an error
    await vi.waitFor(() => expect(getCallCount).toBe(2));
    await transport.close();
  });

  it('close() aborts the GET stream and best-effort DELETEs the session', async () => {
    const getStream = openSseStream();
    let deleted = false;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'DELETE') { deleted = true; return emptyResponse(200); }
      if (method === 'GET') return getStream.response;
      const body = parseBody(init);
      if (body.method === 'initialize') return jsonResponse(200, { jsonrpc: '2.0', id: body.id, result: {} }, { 'mcp-session-id': SESSION_ID });
      return emptyResponse(202);
    });
    vi.stubGlobal('fetch', fetchMock);

    const transport = new LegacyHttpTransport({ kind: 'http', url: URL_ });
    await transport.connect();
    await transport.close();
    expect(deleted).toBe(true);
  });
});
