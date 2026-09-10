/**
 * stdio transport (#2029) — real subprocess correlation, no `npx`/network
 * dependency (spawns `node -e "<fixture>"` directly). Pins: legacy era via
 * an explicit -32601 `server/discover` response (the common real-world
 * shape, per the spec's own "MUST NOT be keyed to one specific error code"
 * guidance), modern era via a `DiscoverResult`, a subprocess crash
 * rejecting in-flight requests, and `close()` reaping the process. The pure
 * timeout-decides-legacy path is covered by `era.test.ts` +
 * `json-rpc.test.ts`'s `PendingRequests` timeout tests — a real 5s wait
 * here would just re-prove the same two units together, slower.
 */
import { describe, it, expect } from 'vitest';
import { StdioTransport } from '../../../src/main/mcp-client/stdio-transport';
import { McpConnectionError } from '../../../src/main/mcp-client/errors';

/** Behavior selected via `FIXTURE_MODE` env var — see branches below. */
const FIXTURE_SCRIPT = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
const mode = process.env.FIXTURE_MODE || 'legacy';
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\\n'); }
rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }
  if (msg.method === 'server/discover') {
    if (mode === 'modern') {
      send({ jsonrpc: '2.0', id: msg.id, result: { supportedVersions: ['2026-07-28'], capabilities: {} } });
    } else {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
    }
    return;
  }
  if (msg.method === 'initialize') {
    send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fixture', version: '0' } } });
    return;
  }
  if (msg.method === 'notifications/initialized') return;
  if (msg.method === 'tools/list') {
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo', description: 'echoes', inputSchema: { type: 'object', properties: {} } }] } });
    return;
  }
  if (msg.method === 'tools/call') {
    if (mode === 'crash-on-call') { process.exit(1); }
    const args = msg.params && msg.params.arguments;
    send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'echoed:' + JSON.stringify(args) }], isError: false } });
    return;
  }
});
`;

function fixtureDescriptor(mode: string) {
  return {
    kind: 'stdio' as const,
    command: process.execPath,
    args: ['-e', FIXTURE_SCRIPT],
    env: { FIXTURE_MODE: mode },
  };
}

describe('StdioTransport (#2029)', () => {
  it('resolves to legacy on an explicit -32601 discover response, then lists/calls tools', async () => {
    const transport = new StdioTransport(fixtureDescriptor('legacy'));
    await transport.connect();
    expect(transport.era).toBe('legacy');

    const tools = await transport.listTools();
    expect(tools).toEqual([{ name: 'echo', description: 'echoes', inputSchema: { type: 'object', properties: {} } }]);

    const result = await transport.callTool('echo', { text: 'hi' });
    expect(result).toEqual({ content: [{ type: 'text', text: 'echoed:{"text":"hi"}' }], isError: false });

    await transport.close();
  });

  it('resolves to modern on a well-formed DiscoverResult, with no legacy handshake', async () => {
    const transport = new StdioTransport(fixtureDescriptor('modern'));
    await transport.connect();
    expect(transport.era).toBe('modern');
    await transport.close();
  });

  it('a subprocess crash rejects the in-flight request', async () => {
    const transport = new StdioTransport(fixtureDescriptor('crash-on-call'));
    await transport.connect();
    await expect(transport.callTool('echo', {})).rejects.toThrow(McpConnectionError);
    await transport.close();
  });

  it('rejects listTools/callTool called on an already-dead transport', async () => {
    const transport = new StdioTransport(fixtureDescriptor('crash-on-call'));
    await transport.connect();
    await expect(transport.callTool('echo', {})).rejects.toThrow(); // kills the process
    await expect(transport.listTools()).rejects.toThrow(McpConnectionError);
  });

  it('close() reaps the subprocess', async () => {
    const transport = new StdioTransport(fixtureDescriptor('legacy'));
    await transport.connect();
    await expect(transport.close()).resolves.toBeUndefined();
    // A second close() on an already-exited process is a harmless no-op.
    await expect(transport.close()).resolves.toBeUndefined();
  });

  it('throws when the spawned command does not exist', async () => {
    const transport = new StdioTransport({ kind: 'stdio', command: '/no/such/binary-xyz' });
    await expect(transport.connect()).rejects.toThrow(McpConnectionError);
  });
});
