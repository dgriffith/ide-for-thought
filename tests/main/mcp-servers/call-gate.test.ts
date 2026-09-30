/**
 * @vitest-environment node
 *
 * The `mcp_call` write-confirmation gate in `callServerTool` (#2439).
 *
 * The transport is a fake client that COUNTS `callTool`; `registry.ts`'s
 * resolution and gate are the real code, and so is the "Don't ask again" store
 * (`tool-permissions.ts`), pointed at a temp file. What is asserted is always
 * the transport count, because "the user denied it" is only true if nothing
 * reached the server.
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { silenceLogTags } from '../../helpers/quiet-logs';
import type { McpCallDecision, McpServerDescriptor, McpToolDescriptor, StoredMcpServerConfig } from '../../../src/shared/mcp-servers';
import { useTempDir } from '../../helpers/temp-project';

const mcpClientMocks = vi.hoisted(() => {
  class McpInteractiveAuthRequiredError extends Error {}
  return {
    McpInteractiveAuthRequiredError,
    connectMcpServer: vi.fn(),
    connectMcpServerWithOAuth: vi.fn(),
  };
});
vi.mock('../../../src/main/mcp-client', () => mcpClientMocks);

const store = vi.hoisted(() => ({ servers: [] as StoredMcpServerConfig[] }));
vi.mock('../../../src/main/mcp-servers/config-store', () => ({
  getStoredServers: vi.fn(async () => store.servers),
  addStoredServer: vi.fn(),
  updateStoredServer: vi.fn(async (id: string, patch: { descriptor?: McpServerDescriptor }) => {
    store.servers = store.servers.map((s) => (s.id === id ? { ...s, ...patch } : s));
  }),
  setStoredServerEnabled: vi.fn(),
  removeStoredServer: vi.fn(),
}));

import { callServerTool, connectServer, updateServer, type McpCallConfirmer } from '../../../src/main/mcp-servers/registry';
import { _setMcpToolPermissionsPathForTests } from '../../../src/main/mcp-servers/tool-permissions';

const TOOLS: McpToolDescriptor[] = [
  { name: 'search', description: 'Search notes', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  { name: 'post_message', description: 'Post to a channel', inputSchema: { type: 'object' } },
  { name: 'explicit_write', inputSchema: { type: 'object' }, annotations: { readOnlyHint: false, title: 'Write a thing' } },
  { name: 'wipe', inputSchema: { type: 'object' }, annotations: { destructiveHint: true } },
];

const DESCRIPTOR: McpServerDescriptor = { kind: 'stdio', command: 'slack-mcp', args: ['--workspace', 'acme'] };

let transport: { callTool: ReturnType<typeof vi.fn>; listTools: ReturnType<typeof vi.fn>; close: ReturnType<typeof vi.fn> };

function confirmer(decision: McpCallDecision) {
  return vi.fn<McpCallConfirmer>(async () => decision);
}

const tmp = useTempDir('minerva-mcp-gate-');
let permissionsFile = '';

beforeEach(async () => {
  permissionsFile = path.join(tmp.root, 'mcp-tool-permissions.json');
  _setMcpToolPermissionsPathForTests(permissionsFile);
  transport = {
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'sent' }], isError: false })),
    listTools: vi.fn(async () => TOOLS),
    close: vi.fn(async () => undefined),
  };
  mcpClientMocks.connectMcpServer.mockReset();
  mcpClientMocks.connectMcpServer.mockResolvedValue(transport);
  store.servers = [{ id: 'srv-1', name: 'slack', enabled: true, descriptor: DESCRIPTOR }];
  await connectServer('srv-1');
});

afterEach(() => {
  _setMcpToolPermissionsPathForTests(null);
});

// Expected: these tests drive failure paths the code logs (#2390).
silenceLogTags('config', 'mcp-confirm');

describe('which calls are gated', () => {
  it('runs a readOnlyHint: true tool without asking', async () => {
    const confirm = confirmer({ allow: false, reason: 'denied' });
    const out = await callServerTool('slack', 'search', { q: 'x' }, confirm);
    expect(out.kind).toBe('called');
    expect(confirm).not.toHaveBeenCalled();
    expect(transport.callTool).toHaveBeenCalledTimes(1);
  });

  it.each(['post_message', 'explicit_write', 'wipe'])('asks before %s (no annotations / readOnlyHint false / destructive)', async (tool) => {
    const confirm = confirmer({ allow: false, reason: 'denied' });
    await callServerTool('slack', tool, {}, confirm);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('shows the card what will be sent: server, tool, description/title, args verbatim', async () => {
    const confirm = confirmer({ allow: false, reason: 'denied' });
    const args = { channel: '#general', text: 'exfil: CANARY', nested: { a: [1, 2] } };
    await callServerTool('slack', 'post_message', args, confirm);
    await callServerTool('slack', 'explicit_write', {}, confirm);
    await callServerTool('slack', 'wipe', {}, confirm);
    expect(confirm.mock.calls[0]![0]).toEqual({
      serverName: 'slack',
      toolName: 'post_message',
      description: 'Post to a channel',
      argsJson: JSON.stringify(args, null, 2),
    });
    expect(confirm.mock.calls[1]![0]).toMatchObject({ toolName: 'explicit_write', title: 'Write a thing' });
    expect(confirm.mock.calls[2]![0]).toMatchObject({ toolName: 'wipe', destructiveHint: true });
  });
});

describe('the decision', () => {
  it('Deny: nothing reaches the transport', async () => {
    const out = await callServerTool('slack', 'post_message', { text: 'x' }, confirmer({ allow: false, reason: 'denied' }));
    expect(out).toEqual({ kind: 'declined', reason: 'denied' });
    expect(transport.callTool).not.toHaveBeenCalled();
  });

  it('Allow: exactly one call, with the approved args', async () => {
    const out = await callServerTool('slack', 'post_message', { text: 'hi' }, confirmer({ allow: true, remember: false }));
    expect(out).toEqual({ kind: 'called', result: { content: [{ type: 'text', text: 'sent' }], isError: false } });
    expect(transport.callTool).toHaveBeenCalledTimes(1);
    expect(transport.callTool).toHaveBeenCalledWith('post_message', { text: 'hi' });
  });

  it('a confirmer that throws is a Deny', async () => {
    const confirm = vi.fn(async () => { throw new Error('renderer went away'); });
    const out = await callServerTool('slack', 'post_message', {}, confirm);
    expect(out).toEqual({ kind: 'declined', reason: 'denied' });
    expect(transport.callTool).not.toHaveBeenCalled();
  });

  it('Allow without "Don\'t ask again" asks again next time and writes nothing', async () => {
    await callServerTool('slack', 'post_message', {}, confirmer({ allow: true, remember: false }));
    const again = confirmer({ allow: false, reason: 'denied' });
    await callServerTool('slack', 'post_message', {}, again);
    expect(again).toHaveBeenCalledTimes(1);
    expect(fs.existsSync(permissionsFile)).toBe(false);
  });

  it('refuses when the server changed while the card was up, sending nothing', async () => {
    let release!: (d: McpCallDecision) => void;
    const confirm = vi.fn(() => new Promise<McpCallDecision>((r) => { release = r; }));
    const pending = callServerTool('slack', 'post_message', {}, confirm);
    await vi.waitFor(() => expect(confirm).toHaveBeenCalled());
    // Reconfigure (disconnects), then reconnect: a new program answers to "slack".
    await updateServer('srv-1', { descriptor: { kind: 'stdio', command: 'other-binary' } });
    await connectServer('srv-1');
    release({ allow: true, remember: true });
    await expect(pending).rejects.toThrow(/changed while the call was awaiting confirmation/);
    expect(transport.callTool).not.toHaveBeenCalled();
    // …and the grant for the old identity is not recorded either.
    expect(fs.existsSync(permissionsFile)).toBe(false);
  });
});

describe('"Don\'t ask again"', () => {
  it('skips the card afterwards for that exact server identity and tool only', async () => {
    await callServerTool('slack', 'post_message', {}, confirmer({ allow: true, remember: true }));
    expect(transport.callTool).toHaveBeenCalledTimes(1);

    const next = confirmer({ allow: false, reason: 'denied' });
    await callServerTool('slack', 'post_message', { text: 'again' }, next);
    expect(next).not.toHaveBeenCalled();
    expect(transport.callTool).toHaveBeenCalledTimes(2);

    // A different tool on the same server still asks.
    await callServerTool('slack', 'explicit_write', {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(transport.callTool).toHaveBeenCalledTimes(2);
  });

  it('is voided when the server\'s connection config changes', async () => {
    await callServerTool('slack', 'post_message', {}, confirmer({ allow: true, remember: true }));
    await updateServer('srv-1', { descriptor: { ...DESCRIPTOR, args: ['--workspace', 'evil'] } });
    await connectServer('srv-1');

    const next = confirmer({ allow: false, reason: 'denied' });
    await callServerTool('slack', 'post_message', {}, next);
    expect(next).toHaveBeenCalledTimes(1);
    expect(transport.callTool).toHaveBeenCalledTimes(1);
  });

  it('survives a rename (identity is the connection config, not the name)', async () => {
    await callServerTool('slack', 'post_message', {}, confirmer({ allow: true, remember: true }));
    store.servers = store.servers.map((s) => ({ ...s, name: 'work-slack' }));
    const next = confirmer({ allow: false, reason: 'denied' });
    await callServerTool('work-slack', 'post_message', {}, next);
    expect(next).not.toHaveBeenCalled();
    expect(transport.callTool).toHaveBeenCalledTimes(2);
  });

  it('a Deny is never remembered', async () => {
    await callServerTool('slack', 'post_message', {}, confirmer({ allow: false, reason: 'denied' }));
    expect(fs.existsSync(permissionsFile)).toBe(false);
  });

  it('a grant that cannot be written still allows THIS call', async () => {
    fs.writeFileSync(permissionsFile, '{ corrupt');
    const out = await callServerTool('slack', 'post_message', {}, confirmer({ allow: true, remember: true }));
    expect(out.kind).toBe('called');
    // The corrupt file was left as it was, not clobbered.
    expect(fs.readFileSync(permissionsFile, 'utf-8')).toBe('{ corrupt');
  });
});

describe('no UI', () => {
  it('refuses a non-read-only call, sending nothing', async () => {
    const out = await callServerTool('slack', 'post_message', { text: 'x' }, null);
    expect(out).toEqual({ kind: 'declined', reason: 'no-ui' });
    expect(transport.callTool).not.toHaveBeenCalled();
  });

  it('refuses even a tool the user chose "Don\'t ask again" for', async () => {
    await callServerTool('slack', 'post_message', {}, confirmer({ allow: true, remember: true }));
    const out = await callServerTool('slack', 'post_message', {}, null);
    expect(out).toEqual({ kind: 'declined', reason: 'no-ui' });
    expect(transport.callTool).toHaveBeenCalledTimes(1);
  });

  it('still runs a read-only tool', async () => {
    const out = await callServerTool('slack', 'search', {}, null);
    expect(out.kind).toBe('called');
  });
});

describe('cancellation', () => {
  it('a cancelled card is a decline, and nothing is sent', async () => {
    const out = await callServerTool('slack', 'post_message', {}, confirmer({ allow: false, reason: 'cancelled' }));
    expect(out).toEqual({ kind: 'declined', reason: 'cancelled' });
    expect(transport.callTool).not.toHaveBeenCalled();
  });
});
