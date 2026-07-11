/**
 * The stdio MCP server (#1146, epic #1145 — Substrate).
 *
 * Two layers: `handleMcpMessage` (the pure JSON-RPC protocol surface, driven by a
 * real Engine over a temp vault) and `runMcpServer` (the stdio plumbing, driven
 * over in-memory streams). Together they prove an external agent can complete the
 * initialize → tools/list → tools/call handshake and get grounded results —
 * without a live client.
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import fsp from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { PassThrough } from 'node:stream';
import { handleMcpMessage, runMcpServer, MCP_TOOLS } from '../../src/cli/mcp';
import { createEngine } from '../../src/cli/engine';
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
      ['propose_note', 'query_graph', 'read_note', 'search_notes', 'semantic_search', 'sql_query'],
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
