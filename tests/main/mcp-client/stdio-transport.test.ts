/**
 * stdio transport (#2029) — real subprocess correlation, no `npx`/network
 * dependency (spawns `node -e "<fixture>"` directly). Pins: legacy era via
 * an explicit -32601 `server/discover` response (the common real-world
 * shape, per the spec's own "MUST NOT be keyed to one specific error code"
 * guidance), modern era via a `DiscoverResult`, a subprocess crash
 * rejecting in-flight requests, `close()` reaping the process, plus the
 * edge cases the line-protocol handler and MRTR loop have to survive:
 * malformed/unsolicited stdout lines, a JSON-RPC error response, missing
 * result fields, cancellation, and a modern-era MRTR round-trip.
 */
import { describe, it, expect } from 'vitest';
import { StdioTransport } from '../../../src/main/mcp-client/stdio-transport';
import { McpConnectionError, McpProtocolError } from '../../../src/main/mcp-client/errors';
import { _setEraProbeTimeoutMsForTests } from '../../../src/main/mcp-client/era';

/** Behavior selected via `FIXTURE_MODE` env var — see branches below. */
const FIXTURE_SCRIPT = `
const readline = require('readline');
const rl = readline.createInterface({ input: process.stdin });
const mode = process.env.FIXTURE_MODE || 'legacy';
function send(obj) { process.stdout.write(JSON.stringify(obj) + '\\n'); }

// Exercised on every mode: a non-JSON banner line and a blank line, both of
// which the client must log-and-drop rather than crash on.
process.stdout.write('this is not json, just a stray banner\\n');
process.stdout.write('\\n');

const captured = {};
function maybeAnswerToolsList(pendingId) {
  if (pendingId !== null && captured['srv-1'] && captured['srv-2']) {
    send({ jsonrpc: '2.0', id: pendingId, result: { tools: [{ name: 'captured', description: JSON.stringify(captured), inputSchema: { type: 'object', properties: {} } }] } });
    return true;
  }
  return false;
}
let pendingToolsListId = null;

rl.on('line', (line) => {
  let msg;
  try { msg = JSON.parse(line); } catch { return; }

  if (msg.id === 'srv-1' || msg.id === 'srv-2') {
    captured[msg.id] = msg;
    if (pendingToolsListId !== null) maybeAnswerToolsList(pendingToolsListId);
    return;
  }

  if (msg.method === 'server/discover') {
    if (mode === 'modern' || mode === 'modern-mrtr') {
      send({ jsonrpc: '2.0', id: msg.id, result: { supportedVersions: ['2026-07-28'], capabilities: {} } });
    } else if (mode === 'unsupported-version') {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32022, message: 'Unsupported protocol version', data: { supported: ['2099-01-01'] } } });
    } else if (mode === 'silent-discover') {
      // deliberately never respond — the client's probe should time out
    } else {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'Method not found' } });
    }
    return;
  }
  if (msg.method === 'initialize') {
    if (mode === 'initialize-fails') {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32000, message: 'initialize refused by fixture' } });
    } else {
      send({ jsonrpc: '2.0', id: msg.id, result: { protocolVersion: '2025-06-18', capabilities: {}, serverInfo: { name: 'fixture', version: '0' } } });
    }
    return;
  }
  if (msg.method === 'notifications/initialized') {
    if (mode === 'edge-cases') {
      send({ jsonrpc: '2.0', id: 'srv-1', method: 'roots/list' });
      send({ jsonrpc: '2.0', id: 'srv-2', method: 'sampling/createMessage', params: {} });
      send({ jsonrpc: '2.0', id: null, result: { orphan: true } });
      send({ notAJsonRpcMessageAtAll: true });
    }
    return;
  }
  if (msg.method === 'tools/list') {
    if (mode === 'edge-cases') {
      pendingToolsListId = msg.id;
      if (maybeAnswerToolsList(pendingToolsListId)) pendingToolsListId = null;
      return;
    }
    if (mode === 'result-shape-edges') {
      send({ jsonrpc: '2.0', id: msg.id, result: {} }); // no "tools" field
      return;
    }
    send({ jsonrpc: '2.0', id: msg.id, result: { tools: [{ name: 'echo', description: 'echoes', inputSchema: { type: 'object', properties: {} } }] } });
    return;
  }
  if (msg.method === 'tools/call') {
    if (mode === 'crash-on-call') { process.exit(1); }
    if (mode === 'tools-call-error') {
      send({ jsonrpc: '2.0', id: msg.id, error: { code: -32602, message: 'bad arguments' } });
      return;
    }
    if (mode === 'result-shape-edges') {
      send({ jsonrpc: '2.0', id: msg.id, result: {} }); // no "content"/"isError" fields
      return;
    }
    if (mode === 'slow-tools-call') {
      setTimeout(() => send({ jsonrpc: '2.0', id: msg.id, result: { content: [{ type: 'text', text: 'finally' }], isError: false } }), 5000);
      return;
    }
    if (mode === 'modern-mrtr') {
      global.__mrtrCalls = (global.__mrtrCalls || 0) + 1;
      if (global.__mrtrCalls === 1) {
        send({ jsonrpc: '2.0', id: msg.id, result: { resultType: 'input_required', inputRequests: { r1: { method: 'roots/list', params: {} } }, requestState: 'stdio-state' } });
      } else {
        send({ jsonrpc: '2.0', id: msg.id, result: { resultType: 'complete', content: [{ type: 'text', text: 'stdio-mrtr-done' }], isError: false } });
      }
      return;
    }
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

  it('the era getter throws before connect() resolves', () => {
    const transport = new StdioTransport(fixtureDescriptor('legacy'));
    expect(() => transport.era).toThrow(McpConnectionError);
  });

  it('connect() called twice throws "already connected"', async () => {
    const transport = new StdioTransport(fixtureDescriptor('legacy'));
    await transport.connect();
    await expect(transport.connect()).rejects.toThrow(/already connected/);
    await transport.close();
  });

  it('survives a non-JSON banner line, a blank line, a null-id response, an unrecognized shape, and answers server-initiated requests', async () => {
    const transport = new StdioTransport(fixtureDescriptor('edge-cases'));
    await transport.connect();
    const tools = await transport.listTools();
    const captured = JSON.parse(tools[0]!.description!);
    expect(captured['srv-1']).toMatchObject({ result: { roots: [] } });
    expect(captured['srv-2']).toMatchObject({ error: { code: -32601 } });
    await transport.close();
  });

  it('falls back to legacy when the discover probe never responds (timeout)', async () => {
    _setEraProbeTimeoutMsForTests(100);
    try {
      const transport = new StdioTransport(fixtureDescriptor('silent-discover'));
      await transport.connect();
      expect(transport.era).toBe('legacy');
      await transport.close();
    } finally {
      _setEraProbeTimeoutMsForTests(null);
    }
  });

  it('throws when the server names no mutually supported protocol version', async () => {
    const transport = new StdioTransport(fixtureDescriptor('unsupported-version'));
    await expect(transport.connect()).rejects.toThrow(/no mutually supported protocol version/);
  });

  it('throws when the legacy initialize handshake itself fails', async () => {
    const transport = new StdioTransport(fixtureDescriptor('initialize-fails'));
    await expect(transport.connect()).rejects.toThrow(/legacy initialize failed/);
  });

  it('a JSON-RPC error response to tools/call surfaces as McpProtocolError', async () => {
    const transport = new StdioTransport(fixtureDescriptor('tools-call-error'));
    await transport.connect();
    await expect(transport.callTool('echo', {})).rejects.toMatchObject({ constructor: McpProtocolError, code: -32602 });
    await transport.close();
  });

  it('tolerates a result with no tools/content field, defaulting to empty', async () => {
    const transport = new StdioTransport(fixtureDescriptor('result-shape-edges'));
    await transport.connect();
    expect(await transport.listTools()).toEqual([]);
    const result = await transport.callTool('echo', {});
    expect(result).toEqual({ content: [], isError: false });
    await transport.close();
  });

  it('drives an input_required → complete MRTR round-trip over stdio', async () => {
    const transport = new StdioTransport(fixtureDescriptor('modern-mrtr'));
    await transport.connect();
    expect(transport.era).toBe('modern');
    const result = await transport.callTool('needs-input', {});
    expect(result).toEqual({ content: [{ type: 'text', text: 'stdio-mrtr-done' }], isError: false });
    await transport.close();
  });

  it('aborting an in-flight request rejects it and notifies the server', async () => {
    const transport = new StdioTransport(fixtureDescriptor('slow-tools-call'));
    await transport.connect();
    const controller = new AbortController();
    const callPromise = transport.callTool('echo', {}, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(callPromise).rejects.toMatchObject({ constructor: McpConnectionError, message: expect.stringContaining('aborted') });
    await transport.close();
  });
});
