/**
 * Shared HTTP plumbing (#2029) — direct unit tests for the pieces both
 * Streamable HTTP transports build on: `timeoutSignal`'s external-abort
 * combination, and `postJsonRpc`'s malformed/wrong-shape body handling and
 * SSE response parsing (including the "answer only arrives in the final,
 * unterminated frame" fallback path).
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { postJsonRpc, timeoutSignal } from '../../../src/main/mcp-client/http/http-common';
import { McpProtocolError } from '../../../src/main/mcp-client/errors';
import { setLogLevel } from '../../../src/shared/logger';

const URL_ = 'http://localhost:9999/mcp';

afterEach(() => vi.unstubAllGlobals());

describe('timeoutSignal', () => {
  it('aborts on its own timeout', async () => {
    vi.useFakeTimers();
    try {
      const signal = timeoutSignal(1000);
      expect(signal.aborted).toBe(false);
      await vi.advanceTimersByTimeAsync(1000);
      expect(signal.aborted).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });

  it('aborts immediately (with the same reason) when the external signal aborts first', () => {
    const external = new AbortController();
    const combined = timeoutSignal(60_000, external.signal);
    expect(combined.aborted).toBe(false);
    external.abort('external-reason');
    expect(combined.aborted).toBe(true);
    expect(combined.reason).toBe('external-reason');
  });
});

describe('postJsonRpc — malformed/wrong-shape bodies', () => {
  it('throws McpProtocolError when the body is not valid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('not json at all {{{', { status: 200, headers: { 'content-type': 'text/plain' } })));
    await expect(postJsonRpc(URL_, { jsonrpc: '2.0', id: 1, method: 'x' }, {})).rejects.toMatchObject({
      constructor: McpProtocolError,
      message: expect.stringContaining('not valid JSON'),
    });
  });

  it('throws McpProtocolError when the body is valid JSON but not a JSON-RPC response', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ hello: 'world' }), { status: 200, headers: { 'content-type': 'application/json' } })));
    await expect(postJsonRpc(URL_, { jsonrpc: '2.0', id: 1, method: 'x' }, {})).rejects.toMatchObject({
      constructor: McpProtocolError,
      message: expect.stringContaining('not a JSON-RPC response'),
    });
  });

  it('finds the answer via flush() when the SSE stream ends without a terminating blank line', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        // No trailing "\n\n" — the frame only completes at stream end.
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: { ok: true } })}`));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })));
    const { response } = await postJsonRpc(URL_, { jsonrpc: '2.0', id: 1, method: 'x' }, {}, { expectedId: 1 });
    expect(response).toEqual({ jsonrpc: '2.0', id: 1, result: { ok: true } });
  });

  it('throws McpProtocolError when an SSE frame contains non-JSON data', async () => {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode('data: not-json-at-all-{{{\n\n'));
        controller.close();
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })));
    await expect(postJsonRpc(URL_, { jsonrpc: '2.0', id: 1, method: 'x' }, {})).rejects.toMatchObject({
      constructor: McpProtocolError,
      message: expect.stringContaining('not valid JSON'),
    });
  });

  it('logs (does not throw) when the SSE reader fails to cancel during best-effort cleanup', async () => {
    const encoder = new TextEncoder();
    // Deliberately left open (never closed) — the match is found via the
    // main read loop's early `return`, so the `finally`'s reader.cancel()
    // applies to a still-live stream and actually invokes the underlying
    // source's cancel() algorithm, rather than a no-op on an already-closed one.
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ jsonrpc: '2.0', id: 1, result: {} })}\n\n`));
      },
      cancel() {
        throw new Error('cancel failed');
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })));
    const debugSpy = vi.spyOn(console, 'debug').mockImplementation(() => {});
    setLogLevel('debug'); // the debug-level log is suppressed at the default 'info' floor
    try {
      // Should resolve normally despite the cancel failure — it's logged, not surfaced.
      const { response } = await postJsonRpc(URL_, { jsonrpc: '2.0', id: 1, method: 'x' }, {}, { expectedId: 1 });
      expect(response).toMatchObject({ id: 1 });
      expect(debugSpy).toHaveBeenCalledWith(expect.stringContaining('cancel failed'), expect.anything());
    } finally {
      setLogLevel('info');
      debugSpy.mockRestore();
    }
  });

  it('returns a null response when the SSE stream ends with no matching frame at all', async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.close(); // ends immediately, nothing sent
      },
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } })));
    const { response } = await postJsonRpc(URL_, { jsonrpc: '2.0', id: 1, method: 'x' }, {}, { expectedId: 1 });
    expect(response).toBeNull();
  });
});
