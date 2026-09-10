/**
 * `connectMcpServer` facade (#2029) — routes `kind: 'stdio'` vs `'http'`,
 * runs HTTP era detection (mocked `fetch`) before picking a transport, and
 * surfaces the throw-vs-`isError` split from `errors.ts`/`types.ts`.
 * `shutdownAllMcpClients` is exercised against injected fake transports so
 * it doesn't depend on a real process/network.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { connectMcpServer, shutdownAllMcpClients } from '../../../src/main/mcp-client/client';
import { McpAuthRequiredError, McpConnectionError } from '../../../src/main/mcp-client/errors';
import { jsonResponse } from '../../helpers/mcp-http-mocks';

function parseBody(init?: RequestInit): Record<string, unknown> {
  return JSON.parse(init?.body as string);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const ECHO_STDIO_SCRIPT = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\\n'); }
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'server/discover') { send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'not found' } }); return; }
  if (msg.method === 'initialize') { send({ jsonrpc: '2.0', id: msg.id, result: {} }); return; }
  if (msg.method === 'notifications/initialized') return;
  if (msg.method === 'tools/list') { send({ jsonrpc: '2.0', id: msg.id, result: { tools: [] } }); return; }
});
`;

describe('connectMcpServer (#2029)', () => {
  it('routes a stdio descriptor to a real stdio connection', async () => {
    const client = await connectMcpServer({ kind: 'stdio', command: process.execPath, args: ['-e', ECHO_STDIO_SCRIPT] });
    expect(client.era).toBe('legacy');
    expect(await client.listTools()).toEqual([]);
    await client.close();
  });

  it('routes an http descriptor to the modern transport when server/discover succeeds', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = parseBody(init);
      if (body.method === 'server/discover') {
        return jsonResponse(200, { jsonrpc: '2.0', id: body.id, result: { resultType: 'complete', supportedVersions: ['2026-07-28'] } });
      }
      return jsonResponse(200, { jsonrpc: '2.0', id: body.id, result: { resultType: 'complete', tools: [] } });
    }));
    const client = await connectMcpServer({ kind: 'http', url: 'http://localhost:9999/mcp' });
    expect(client.era).toBe('modern');
    await client.close();
  });

  it('routes an http descriptor to the legacy transport when server/discover fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const method = init?.method ?? 'GET';
      if (method === 'GET') return new Response(new ReadableStream(), { status: 200, headers: { 'content-type': 'text/event-stream' } });
      const body = parseBody(init);
      if (body.method === 'server/discover') return new Response(null, { status: 500 });
      if (body.method === 'initialize') {
        return jsonResponse(200, { jsonrpc: '2.0', id: body.id, result: {} }, { 'mcp-session-id': 'sess-1' });
      }
      return new Response(null, { status: 202 });
    }));
    const client = await connectMcpServer({ kind: 'http', url: 'http://localhost:9999/mcp' });
    expect(client.era).toBe('legacy');
    await client.close();
  });

  it('propagates McpAuthRequiredError from the discover probe without trying legacy', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(connectMcpServer({ kind: 'http', url: 'http://localhost:9999/mcp' })).rejects.toBeInstanceOf(McpAuthRequiredError);
    // Only the discover probe should have been attempted — no legacy initialize follow-up.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('throws a combined McpConnectionError when both the modern probe and the legacy handshake fail', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = parseBody(init);
      if (body.method === 'server/discover') return new Response(null, { status: 500 });
      return new Response(null, { status: 500 }); // legacy initialize also fails
    }));
    await expect(connectMcpServer({ kind: 'http', url: 'http://localhost:9999/mcp' })).rejects.toThrow(McpConnectionError);
  });

  it('propagates McpAuthRequiredError from the LEGACY handshake, not wrapped in the combined error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => {
      const body = parseBody(init);
      if (body.method === 'server/discover') return new Response(null, { status: 500 }); // generic failure, falls back to legacy
      return new Response(null, { status: 401 }); // legacy initialize requires auth
    }));
    await expect(connectMcpServer({ kind: 'http', url: 'http://localhost:9999/mcp' })).rejects.toBeInstanceOf(McpAuthRequiredError);
  });
});

describe('shutdownAllMcpClients (#2029)', () => {
  it('closes every live connection and clears the registry', async () => {
    const clientA = await connectMcpServer({ kind: 'stdio', command: process.execPath, args: ['-e', ECHO_STDIO_SCRIPT] });
    const clientB = await connectMcpServer({ kind: 'stdio', command: process.execPath, args: ['-e', ECHO_STDIO_SCRIPT] });
    await shutdownAllMcpClients();
    // Both underlying processes are gone — a further call throws rather than hanging.
    await expect(clientA.listTools()).rejects.toThrow();
    await expect(clientB.listTools()).rejects.toThrow();
    // Idempotent — nothing left to close.
    await expect(shutdownAllMcpClients()).resolves.toBeUndefined();
  });
});
