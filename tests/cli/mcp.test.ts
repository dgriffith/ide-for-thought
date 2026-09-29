/**
 * The stdio MCP server (#1146, epic #1145 — Substrate).
 *
 * Two layers: `handleMcpMessage` (the pure JSON-RPC protocol surface, driven by a
 * real Engine over a temp vault) and `runMcpServer` (the stdio plumbing, driven
 * over in-memory streams). Together they prove an external agent can complete the
 * initialize → tools/list → tools/call handshake and get grounded results —
 * without a live client.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PassThrough } from 'node:stream';
import {
  handleMcpMessage,
  handleMcpLine,
  encodeResponse,
  installStdioGuards,
  runMcpServer,
  MCP_TOOLS,
} from '../../src/cli/mcp';
import { createEngine, type Engine } from '../../src/cli/engine';
import { projectContext } from '../../src/main/project-context-types';

let root: string;
const engine = () => createEngine(projectContext(root));

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-mcp-'));
  await fsp.writeFile(
    path.join(root, 'photosynthesis.md'),
    '---\ntitle: Photosynthesis\n---\n\nConverts light to chemical energy.\n',
    'utf-8',
  );
  await fsp.writeFile(path.join(root, 'plants.csv'), 'name,height_cm\nfern,40\nmoss,3\n', 'utf-8');
});

afterAll(async () => {
  await fsp.rm(root, { recursive: true, force: true });
});

describe('handleMcpMessage — handshake & discovery', () => {
  it('initialize echoes the requested protocol version and advertises tools', async () => {
    const r = await handleMcpMessage(
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
      engine(),
    );
    expect(r?.id).toBe(1);
    const result = r?.result as Record<string, unknown>;
    expect(result.protocolVersion).toBe('2025-06-18');
    expect(result.capabilities).toEqual({ tools: {} });
    expect((result.serverInfo as { name: string }).name).toBe('minerva');
  });

  it('tools/list returns every read tool with a JSON-Schema input', async () => {
    const r = await handleMcpMessage({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, engine());
    const tools = (r?.result as { tools: { name: string; inputSchema: unknown }[] }).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(
      ['gather_context', 'grep_notes', 'propose_note', 'query_graph', 'read_note', 'search_notes', 'semantic_search', 'sql_query'],
    );
    for (const t of tools) expect(t.inputSchema).toHaveProperty('type', 'object');
  });

  it('the initialized notification gets no response', async () => {
    const r = await handleMcpMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, engine());
    expect(r).toBeNull();
  });

  it('an unknown request method is method-not-found (-32601)', async () => {
    const r = await handleMcpMessage({ jsonrpc: '2.0', id: 9, method: 'no/such/method' }, engine());
    expect(r?.error?.code).toBe(-32601);
  });
});

describe('handleMcpMessage — tools/call', () => {
  async function call(name: string, args: Record<string, unknown>) {
    return handleMcpMessage(
      { jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name, arguments: args } },
      engine(),
    );
  }

  it('query_graph returns grounded SPARQL bindings as text content', async () => {
    const r = await call('query_graph', {
      sparql: 'SELECT ?title WHERE { ?n a minerva:Note ; dc:title ?title }',
    });
    const content = (r?.result as { content: { type: string; text: string }[] }).content;
    expect(content[0].type).toBe('text');
    const parsed = JSON.parse(content[0].text);
    expect(parsed.results.map((row: Record<string, string>) => row.title)).toContain('Photosynthesis');
  });

  it('sql_query returns rows (DuckDB BigInt serialized safely)', async () => {
    const r = await call('sql_query', { sql: 'SELECT COUNT(*) AS n FROM plants' });
    const content = (r?.result as { content: { text: string }[] }).content;
    expect(JSON.parse(content[0].text).rows[0].n).toBe(2);
  });

  it('read_note returns the markdown, grounded with the path', async () => {
    const r = await call('read_note', { relative_path: 'photosynthesis.md' });
    const parsed = JSON.parse((r?.result as { content: { text: string }[] }).content[0].text);
    expect(parsed.path).toBe('photosynthesis.md');
    expect(parsed.content).toContain('chemical energy');
  });

  it('grep_notes returns exact matches grounded with path + line', async () => {
    const r = await call('grep_notes', { pattern: 'chemical energy' });
    const parsed = JSON.parse((r?.result as { content: { text: string }[] }).content[0].text);
    expect(parsed.total).toBe(1);
    expect(parsed.matches[0]).toMatchObject({ path: 'photosynthesis.md', line: 5 });
    expect(parsed.matches[0].text).toContain('chemical energy');
  });

  it('a tool failure is an MCP tool result with isError, not a JSON-RPC error', async () => {
    const r = await call('query_graph', { sparql: 'THIS IS NOT SPARQL' });
    expect(r?.error).toBeUndefined();
    const result = r?.result as { content: { text: string }[]; isError?: boolean };
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toBeTruthy();
  });

  it('an unknown tool name is rejected (-32602)', async () => {
    const r = await call('destroy_everything', {});
    expect(r?.error?.code).toBe(-32602);
  });

  it('gather_context returns a slice: matching notes with content and neighborhood', async () => {
    const r = await call('gather_context', { topic: 'photosynthesis' });
    const parsed = JSON.parse((r?.result as { content: { text: string }[] }).content[0].text);
    expect(parsed.topic).toBe('photosynthesis');
    const hit = parsed.notes.find((n: { path: string }) => n.path === 'photosynthesis.md');
    expect(hit).toBeTruthy();
    expect(hit.content).toContain('chemical energy');
    expect(Array.isArray(hit.backlinks)).toBe(true);
    expect(Array.isArray(hit.outgoingLinks)).toBe(true);
  });
});

describe('handleMcpMessage — propose_note (write through the gate)', () => {
  it('files a PENDING proposal stamped mcp:<client>, without writing the note', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-mcp-propose-'));
    try {
      const eng = createEngine(projectContext(vault));
      const session: { clientName?: string } = {};
      // The initialize handshake carries the client name → propose provenance.
      await handleMcpMessage(
        { jsonrpc: '2.0', id: 1, method: 'initialize', params: { clientInfo: { name: 'claude-code' } } },
        eng,
        session,
      );
      const r = await handleMcpMessage(
        {
          jsonrpc: '2.0',
          id: 2,
          method: 'tools/call',
          params: {
            name: 'propose_note',
            arguments: { relative_path: 'ideas/spark.md', content: '# Spark\n\nA proposed idea.\n' },
          },
        },
        eng,
        session,
      );
      const result = r?.result as { content: { text: string }[]; isError?: boolean };
      expect(result.isError).toBeFalsy();
      const out = JSON.parse(result.content[0].text);
      expect(out.status).toBe('pending');
      expect(out.proposedBy).toBe('mcp:claude-code');
      expect(out.proposalUri).toBeTruthy();
      // Pending — the note is NOT written to the vault.
      expect(fs.existsSync(path.join(vault, 'ideas', 'spark.md'))).toBe(false);
      // The proposal IS persisted to graph.ttl for the app's review queue.
      const ttl = await fsp.readFile(path.join(vault, '.minerva', 'graph.ttl'), 'utf-8');
      expect(ttl).toContain('Proposal');
      expect(ttl).toContain('claude-code');
    } finally {
      await fsp.rm(vault, { recursive: true, force: true });
    }
  });

  it('stamps mcp:unknown when the client sent no name', async () => {
    const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-mcp-anon-'));
    try {
      const eng = createEngine(projectContext(vault));
      const r = await handleMcpMessage(
        {
          jsonrpc: '2.0',
          id: 1,
          method: 'tools/call',
          params: { name: 'propose_note', arguments: { relative_path: 'x.md', content: 'body' } },
        },
        eng,
        {},
      );
      const out = JSON.parse((r?.result as { content: { text: string }[] }).content[0].text);
      expect(out.proposedBy).toBe('mcp:unknown');
    } finally {
      await fsp.rm(vault, { recursive: true, force: true });
    }
  });
});

describe('MCP_TOOLS metadata', () => {
  it('every tool marks its required inputs', () => {
    for (const t of MCP_TOOLS) {
      expect(Array.isArray(t.inputSchema.required)).toBe(true);
      expect(t.inputSchema.required!.length).toBeGreaterThan(0);
    }
  });
});

describe('runMcpServer over stdio streams', () => {
  it('completes a full initialize → tools/call handshake and closes on stdin end', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (c: Buffer) => chunks.push(c));

    const done = runMcpServer(root, { input, output });

    input.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }) + '\n');
    input.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
    input.write(
      JSON.stringify({
        jsonrpc: '2.0',
        id: 2,
        method: 'tools/call',
        params: { name: 'read_note', arguments: { relative_path: 'photosynthesis.md' } },
      }) + '\n',
    );
    input.end();
    await done;

    const lines = Buffer.concat(chunks).toString('utf-8').trim().split('\n').filter(Boolean);
    const responses = lines.map((l) => JSON.parse(l));
    // Two responses (initialize id 1, tools/call id 2); the notification got none.
    expect(responses.map((r) => r.id)).toEqual([1, 2]);
    expect(responses[0].result.serverInfo.name).toBe('minerva');
    const parsed = JSON.parse(responses[1].result.content[0].text);
    expect(parsed.content).toContain('chemical energy');
  });

  it('a malformed line yields a JSON-RPC parse error, not a crash', async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    const chunks: Buffer[] = [];
    output.on('data', (c: Buffer) => chunks.push(c));

    const done = runMcpServer(root, { input, output });
    input.write('{ not valid json\n');
    input.end();
    await done;

    const resp = JSON.parse(Buffer.concat(chunks).toString('utf-8').trim());
    expect(resp.error.code).toBe(-32700);
  });
});

// ── #2418: one bad message must not end the session ─────────────────────────

/** An engine whose every tool throws — the shape #2418 was about: a tool that
 *  THROWS rather than returning `{ ok: false }`. */
function throwingEngine(message = 'boom'): Engine {
  const fail = async (): Promise<never> => {
    throw new Error(message);
  };
  return {
    query: fail,
    sql: fail,
    agentSql: fail,
    search: fail,
    grep: fail,
    semantic: fail,
    read: fail,
    agentRead: fail,
    context: fail,
    proposeNote: fail,
  };
}

type WireResult = { isError?: boolean; content: { type: string; text: string }[]; tools: unknown[] };
type Wire = { id?: unknown; result: WireResult; error?: { code: number; message: string } };

/** Drive `runMcpServer` over in-memory streams with the given raw lines, and
 *  return the parsed responses. Times out (fails) if the server never closes —
 *  which is what a poisoned serial chain looks like. */
async function serve(lines: string[], eng?: Engine): Promise<Wire[]> {
  const input = new PassThrough();
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (c: Buffer) => chunks.push(c));
  const done = runMcpServer(root, { input, output, engine: eng, processGuards: false });
  for (const l of lines) input.write(`${l}\n`);
  input.end();
  await done;
  return Buffer.concat(chunks)
    .toString('utf-8')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Wire);
}

const rpc = (id: number, method: string, params?: unknown) =>
  JSON.stringify({ jsonrpc: '2.0', id, method, ...(params === undefined ? {} : { params }) });

describe('#2418 — a tool that throws', () => {
  it('comes back as an isError tool result, not a rejection or a JSON-RPC error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const eng = throwingEngine('kaboom');
      const r = await handleMcpMessage(
        { jsonrpc: '2.0', id: 11, method: 'tools/call', params: { name: 'query_graph', arguments: { sparql: 'x' } } },
        eng,
      );
      expect(r?.id).toBe(11);
      expect(r?.error).toBeUndefined();
      const result = r?.result as { content: { type: string; text: string }[]; isError?: boolean };
      expect(result.isError).toBe(true);
      expect(result.content[0].type).toBe('text');
      expect(result.content[0].text).toContain('kaboom');
      // …and the same engine/session keeps answering.
      const list = await handleMcpMessage({ jsonrpc: '2.0', id: 12, method: 'tools/list' }, eng);
      expect((list?.result as { tools: unknown[] }).tools.length).toBe(MCP_TOOLS.length);
      // The operator gets the stack on stderr (console.warn), not stdout.
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });

  it('over stdio: the server answers the throw with isError, keeps serving, and closes cleanly', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const responses = await serve(
        [
          rpc(1, 'initialize', {}),
          rpc(2, 'tools/call', { name: 'read_note', arguments: { relative_path: 'x.md' } }),
          rpc(3, 'tools/list'),
          rpc(4, 'ping'),
        ],
        throwingEngine(),
      );
      expect(responses.map((r) => r.id)).toEqual([1, 2, 3, 4]);
      expect(responses[1].result.isError).toBe(true);
      expect(responses[1].result.content[0].text).toContain('boom');
      expect(responses[2].result.tools.length).toBe(MCP_TOOLS.length);
      expect(responses[3].result).toEqual({});
    } finally {
      warn.mockRestore();
    }
  });

  it('a result that cannot be serialized is still an isError result for that call', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      const eng = { ...throwingEngine(), query: async () => ({ ok: true, data: cyclic }) } as unknown as Engine;
      const r = await handleMcpMessage(
        { jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'query_graph', arguments: { sparql: 'x' } } },
        eng,
      );
      expect((r?.result as { isError?: boolean }).isError).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });
});

describe('#2418 — protocol errors keep their JSON-RPC shape', () => {
  it('an unknown tool is -32602 naming the tool, with no result', async () => {
    const r = await handleMcpMessage(
      { jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'no_such_tool', arguments: {} } },
      engine(),
    );
    expect(r).toEqual({ jsonrpc: '2.0', id: 21, error: { code: -32602, message: 'Unknown tool: no_such_tool' } });
  });

  it.each([
    ['missing params', undefined],
    ['params not an object', 'query_graph'],
    ['missing name', { arguments: {} }],
    ['non-string name', { name: 42 }],
    ['arguments is an array', { name: 'query_graph', arguments: ['SELECT'] }],
    ['arguments is a string', { name: 'query_graph', arguments: 'SELECT' }],
  ])('tools/call with %s is -32602 invalid params', async (_label, params) => {
    const r = await handleMcpMessage(
      { jsonrpc: '2.0', id: 22, method: 'tools/call', params: params as Record<string, unknown> },
      throwingEngine(),
    );
    expect(r?.id).toBe(22);
    expect(r?.error?.code).toBe(-32602);
    expect(r?.result).toBeUndefined();
  });
});

describe('#2418 — handleMcpLine: every bad line is answered in-band', () => {
  it.each([
    ['unparseable JSON', '{ nope', -32700],
    ['JSON null', 'null', -32600],
    ['a number', '42', -32600],
    ['a string', '"hi"', -32600],
    ['a batch array', '[{"jsonrpc":"2.0","id":1,"method":"ping"}]', -32600],
    ['a non-string method', '{"jsonrpc":"2.0","id":1,"method":5}', -32600],
    ['an object id', '{"jsonrpc":"2.0","id":{},"method":"ping"}', -32600],
  ])('%s → %i', async (_label, line, code) => {
    const r = await handleMcpLine(line, engine());
    expect(r?.error?.code).toBe(code);
  });

  it('a non-string method echoes a valid id so the client can correlate', async () => {
    const r = await handleMcpLine('{"jsonrpc":"2.0","id":"abc","method":5}', engine());
    expect(r?.id).toBe('abc');
  });

  it('over stdio: malformed and invalid lines do not stop the messages after them', async () => {
    const responses = await serve(['{ not json', 'null', '[1,2]', '"x"', rpc(9, 'ping')]);
    expect(responses.map((r) => r.error?.code ?? 'ok')).toEqual([-32700, -32600, -32600, -32600, 'ok']);
    expect(responses[4].id).toBe(9);
  });
});

describe('#2418 — the write side', () => {
  it('encodeResponse turns an unserializable response into an internal error for the same id', () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const cyclic: Record<string, unknown> = {};
      cyclic.self = cyclic;
      const out = JSON.parse(encodeResponse({ jsonrpc: '2.0', id: 7, result: cyclic })) as Wire;
      expect(out.id).toBe(7);
      expect(out.error?.code).toBe(-32603);
    } finally {
      err.mockRestore();
    }
  });

  it('an output stream error (client gone, EPIPE) winds the server down instead of throwing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const input = new PassThrough();
      const output = new PassThrough();
      const done = runMcpServer(root, { input, output, engine: throwingEngine(), processGuards: false });
      output.emit('error', Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
      await done; // resolves: readline was closed; nothing threw
      expect(warn).toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('#2418 — installStdioGuards', () => {
  function fakes() {
    const proc = new EventEmitter();
    const calls: { error: unknown[][]; stdout: unknown[][] } = { error: [], stdout: [] };
    const cons = {
      log: (...a: unknown[]) => calls.stdout.push(a),
      info: (...a: unknown[]) => calls.stdout.push(a),
      debug: (...a: unknown[]) => calls.stdout.push(a),
      error: (...a: unknown[]) => calls.error.push(a),
    };
    return { proc, cons, calls };
  }

  it('logs an unhandled rejection to stderr instead of letting it end the process', () => {
    const { proc, cons } = fakes();
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const dispose = installStdioGuards(proc, cons);
      expect(proc.listenerCount('unhandledRejection')).toBe(1);
      proc.emit('unhandledRejection', new Error('detached'), Promise.resolve());
      // `logger` writes through the global console.error → stderr.
      expect(err).toHaveBeenCalledWith(expect.stringContaining('unhandled rejection'), expect.any(Error));
      dispose();
      expect(proc.listenerCount('unhandledRejection')).toBe(0);
    } finally {
      err.mockRestore();
    }
  });

  it('points console.log/info/debug at stderr while installed, and restores them after', () => {
    const { proc, cons, calls } = fakes();
    const original = { log: cons.log, info: cons.info, debug: cons.debug };
    const dispose = installStdioGuards(proc, cons);
    cons.log('a');
    cons.info('b');
    cons.debug('c');
    expect(calls.error).toEqual([['a'], ['b'], ['c']]);
    expect(calls.stdout).toEqual([]);
    dispose();
    expect(cons.log).toBe(original.log);
    expect(cons.info).toBe(original.info);
    expect(cons.debug).toBe(original.debug);
  });
});
