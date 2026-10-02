/**
 * Live MCP server connection lifecycle (#2031) — `../mcp-client` and
 * `./config-store` are both mocked so this exercises registry.ts's own
 * status-transition logic (connecting/connected/needs-auth/error,
 * enable/disable, update-triggers-disconnect) without any real subprocess
 * spawn, network call, or file I/O. `McpInteractiveAuthRequiredError` is a
 * fresh stand-in class defined inside the hoisted mock (not the real one
 * from `errors.ts`) — registry.ts's `instanceof` check only needs to agree
 * with whatever this test throws, and importing the real class would pull
 * in the whole `mcp-client` barrel (including the OAuth module's `electron`
 * imports) for no benefit here.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { McpServerDescriptor, StoredMcpServerConfig } from '../../../src/shared/mcp-servers';

const mcpClientMocks = vi.hoisted(() => {
  class McpInteractiveAuthRequiredError extends Error {}
  return {
    McpInteractiveAuthRequiredError,
    connectMcpServer: vi.fn(),
    connectMcpServerWithOAuth: vi.fn(),
  };
});
vi.mock('../../../src/main/mcp-client', () => mcpClientMocks);

const configStoreState = vi.hoisted(() => ({ servers: [] as StoredMcpServerConfig[] }));
vi.mock('../../../src/main/mcp-servers/config-store', () => ({
  getStoredServers: vi.fn(async () => configStoreState.servers),
  addStoredServer: vi.fn(async (name: string, descriptor: McpServerDescriptor) => {
    const server: StoredMcpServerConfig = { id: `id-${configStoreState.servers.length + 1}`, name, enabled: false, descriptor };
    configStoreState.servers = [...configStoreState.servers, server];
    return server;
  }),
  updateStoredServer: vi.fn(async (id: string, patch: { name?: string; descriptor?: McpServerDescriptor }) => {
    let updated: StoredMcpServerConfig | null = null;
    configStoreState.servers = configStoreState.servers.map((s) => {
      if (s.id !== id) return s;
      updated = { ...s, ...patch };
      return updated;
    });
    return updated;
  }),
  setStoredServerEnabled: vi.fn(async (id: string, enabled: boolean) => {
    let updated: StoredMcpServerConfig | null = null;
    configStoreState.servers = configStoreState.servers.map((s) => {
      if (s.id !== id) return s;
      updated = { ...s, enabled };
      return updated;
    });
    return updated;
  }),
  removeStoredServer: vi.fn(async (id: string) => {
    configStoreState.servers = configStoreState.servers.filter((s) => s.id !== id);
  }),
}));

import {
  addServer,
  callServerTool,
  connectAllEnabledServers,
  connectServer,
  removeServer,
  setServerEnabled,
  updateServer,
} from '../../../src/main/mcp-servers/registry';

const stdioDescriptor: McpServerDescriptor = { kind: 'stdio', command: 'npx' };
const httpDescriptor: McpServerDescriptor = { kind: 'http', url: 'https://mcp.example.com/mcp' };

let mockClient: {
  listTools: ReturnType<typeof vi.fn>;
  close: ReturnType<typeof vi.fn>;
  callTool: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  configStoreState.servers = [];
  vi.clearAllMocks();
  mockClient = {
    listTools: vi.fn(async () => []),
    close: vi.fn(async () => undefined),
    callTool: vi.fn(async () => ({ content: [{ type: 'text', text: 'ok' }], isError: false })),
  };
});

async function firstId(): Promise<string> {
  const id = configStoreState.servers[0]?.id;
  if (!id) throw new Error('expected a server to exist');
  return id;
}

describe('addServer / removeServer', () => {
  it('persists a new server and reports it disconnected with no tools', async () => {
    const list = await addServer('S', stdioDescriptor);
    expect(list).toEqual([{ id: expect.any(String), name: 'S', enabled: false, descriptor: stdioDescriptor, status: 'disconnected', tools: [] }]);
  });

  it('removeServer disconnects a live connection and removes the config entry', async () => {
    mcpClientMocks.connectMcpServer.mockResolvedValue(mockClient);
    await addServer('S', stdioDescriptor);
    const id = await firstId();
    await setServerEnabled(id, true);
    const list = await removeServer(id);
    expect(mockClient.close).toHaveBeenCalledTimes(1);
    expect(list).toEqual([]);
  });
});

describe('setServerEnabled', () => {
  it('connects a stdio server via connectMcpServer, non-interactively', async () => {
    mcpClientMocks.connectMcpServer.mockResolvedValue(mockClient);
    mockClient.listTools.mockResolvedValue([{ name: 'tool1', inputSchema: { type: 'object' } }]);
    await addServer('S', stdioDescriptor);
    const id = await firstId();
    const list = await setServerEnabled(id, true);
    expect(mcpClientMocks.connectMcpServer).toHaveBeenCalledWith(stdioDescriptor);
    expect(mcpClientMocks.connectMcpServerWithOAuth).not.toHaveBeenCalled();
    expect(list[0]).toMatchObject({ status: 'connected', tools: [{ name: 'tool1', inputSchema: { type: 'object' } }] });
  });

  it('connects a remote server via connectMcpServerWithOAuth, non-interactively', async () => {
    mcpClientMocks.connectMcpServerWithOAuth.mockResolvedValue(mockClient);
    await addServer('R', httpDescriptor);
    const id = await firstId();
    await setServerEnabled(id, true);
    expect(mcpClientMocks.connectMcpServerWithOAuth).toHaveBeenCalledWith(httpDescriptor, { interactive: false });
    expect(mcpClientMocks.connectMcpServer).not.toHaveBeenCalled();
  });

  it('lands on needs-auth when a non-interactive connect requires interaction', async () => {
    mcpClientMocks.connectMcpServerWithOAuth.mockRejectedValue(new mcpClientMocks.McpInteractiveAuthRequiredError('nope'));
    await addServer('R', httpDescriptor);
    const id = await firstId();
    const list = await setServerEnabled(id, true);
    expect(list[0]).toMatchObject({ status: 'needs-auth', tools: [] });
  });

  it('lands on error with the failure message on any other connect failure', async () => {
    mcpClientMocks.connectMcpServer.mockRejectedValue(new Error('boom'));
    await addServer('S', stdioDescriptor);
    const id = await firstId();
    const list = await setServerEnabled(id, true);
    expect(list[0]).toMatchObject({ status: 'error', error: 'boom', tools: [] });
  });

  it('stringifies a non-Error thrown value as the error message', async () => {
    mcpClientMocks.connectMcpServer.mockRejectedValue('boom');
    await addServer('S', stdioDescriptor);
    const id = await firstId();
    const list = await setServerEnabled(id, true);
    expect(list[0]).toMatchObject({ status: 'error', error: 'boom' });
  });

  it('disconnects a live connection when disabled', async () => {
    mcpClientMocks.connectMcpServer.mockResolvedValue(mockClient);
    await addServer('S', stdioDescriptor);
    const id = await firstId();
    await setServerEnabled(id, true);
    const list = await setServerEnabled(id, false);
    expect(mockClient.close).toHaveBeenCalledTimes(1);
    expect(list[0]).toMatchObject({ status: 'disconnected', tools: [] });
  });
});

describe('connectServer', () => {
  it('always passes interactive: true', async () => {
    mcpClientMocks.connectMcpServerWithOAuth.mockResolvedValue(mockClient);
    await addServer('R', httpDescriptor);
    const id = await firstId();
    await connectServer(id);
    expect(mcpClientMocks.connectMcpServerWithOAuth).toHaveBeenCalledWith(httpDescriptor, { interactive: true });
  });

  it('throws for an unknown server id', async () => {
    await expect(connectServer('nonexistent')).rejects.toThrow(/no such MCP server/);
  });
});

describe('updateServer', () => {
  it('a changed descriptor drops the old connection and reconnects an enabled server to the new one', async () => {
    mcpClientMocks.connectMcpServer.mockResolvedValue(mockClient);
    await addServer('S', stdioDescriptor);
    const id = await firstId();
    await setServerEnabled(id, true);
    const changed: McpServerDescriptor = { ...stdioDescriptor, args: ['--other'] };
    const list = await updateServer(id, { descriptor: changed });
    expect(mockClient.close).toHaveBeenCalledTimes(1);
    expect(mcpClientMocks.connectMcpServer).toHaveBeenCalledTimes(2);
    expect(mcpClientMocks.connectMcpServer).toHaveBeenLastCalledWith(changed);
    expect(list[0]).toMatchObject({ descriptor: changed, status: 'connected' });
  });

  it('re-saving the same details (the settings form sends them every time) keeps the connection', async () => {
    mcpClientMocks.connectMcpServer.mockResolvedValue(mockClient);
    await addServer('S', stdioDescriptor);
    const id = await firstId();
    await setServerEnabled(id, true);
    const list = await updateServer(id, { name: 'Renamed', descriptor: { ...stdioDescriptor } });
    expect(mockClient.close).not.toHaveBeenCalled();
    expect(mcpClientMocks.connectMcpServer).toHaveBeenCalledTimes(1);
    expect(list[0]).toMatchObject({ name: 'Renamed', status: 'connected' });
  });

  it('a disabled server stays disconnected after its details change', async () => {
    await addServer('S', stdioDescriptor);
    const id = await firstId();
    const list = await updateServer(id, { descriptor: { ...stdioDescriptor, command: 'other-binary' } });
    expect(mcpClientMocks.connectMcpServer).not.toHaveBeenCalled();
    expect(list[0]).toMatchObject({ status: 'disconnected' });
  });

  it('switching to a remote server reconnects without popping a browser', async () => {
    mcpClientMocks.connectMcpServer.mockResolvedValue(mockClient);
    mcpClientMocks.connectMcpServerWithOAuth.mockResolvedValue(mockClient);
    await addServer('S', stdioDescriptor);
    const id = await firstId();
    await setServerEnabled(id, true);
    await updateServer(id, { descriptor: httpDescriptor });
    expect(mockClient.close).toHaveBeenCalledTimes(1);
    const [, opts] = mcpClientMocks.connectMcpServerWithOAuth.mock.calls.at(-1)! as [unknown, { interactive?: boolean } | undefined];
    expect(opts?.interactive ?? false).toBe(false);
  });

  it('does not disconnect on a name-only edit', async () => {
    mcpClientMocks.connectMcpServer.mockResolvedValue(mockClient);
    await addServer('S', stdioDescriptor);
    const id = await firstId();
    await setServerEnabled(id, true);
    const list = await updateServer(id, { name: 'Renamed' });
    expect(mockClient.close).not.toHaveBeenCalled();
    expect(list[0]).toMatchObject({ name: 'Renamed', status: 'connected' });
  });
});

describe('connectAllEnabledServers', () => {
  it('connects every enabled server via the right function and skips disabled ones', async () => {
    mcpClientMocks.connectMcpServer.mockResolvedValue(mockClient);
    mcpClientMocks.connectMcpServerWithOAuth.mockResolvedValue(mockClient);
    await addServer('Enabled stdio', stdioDescriptor);
    await addServer('Enabled http', httpDescriptor);
    await addServer('Disabled', stdioDescriptor);
    configStoreState.servers = configStoreState.servers.map((s, i) => ({ ...s, enabled: i < 2 }));

    await connectAllEnabledServers();

    expect(mcpClientMocks.connectMcpServer).toHaveBeenCalledTimes(1);
    expect(mcpClientMocks.connectMcpServerWithOAuth).toHaveBeenCalledTimes(1);
  });

  it('never throws even when a connect attempt fails', async () => {
    mcpClientMocks.connectMcpServer.mockRejectedValue(new Error('boom'));
    await addServer('S', stdioDescriptor);
    configStoreState.servers = configStoreState.servers.map((s) => ({ ...s, enabled: true }));
    await expect(connectAllEnabledServers()).resolves.toBeUndefined();
  });
});

describe('callServerTool', () => {
  it('delegates to the connected client, addressed by server name', async () => {
    // Read-only, so it runs without a confirmer; the gate itself is
    // exercised in call-gate.test.ts (#2439).
    mockClient.listTools.mockResolvedValue([{ name: 'do_thing', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } }]);
    mcpClientMocks.connectMcpServer.mockResolvedValue(mockClient);
    await addServer('S', stdioDescriptor);
    const id = await firstId();
    await setServerEnabled(id, true);

    const result = await callServerTool('S', 'do_thing', { x: 1 }, null);

    expect(mockClient.callTool).toHaveBeenCalledWith('do_thing', { x: 1 });
    expect(result).toEqual({ kind: 'called', result: { content: [{ type: 'text', text: 'ok' }], isError: false } });
  });

  it('refuses a tool the server did not advertise, without calling it (#2373)', async () => {
    // mcp_call's tool name is model-chosen text; only the catalog the user can
    // see in Settings (what listTools returned at connect) is callable.
    mockClient.listTools.mockResolvedValue([{ name: 'search', inputSchema: { type: 'object' } }]);
    mcpClientMocks.connectMcpServer.mockResolvedValue(mockClient);
    await addServer('S', stdioDescriptor);
    const id = await firstId();
    await setServerEnabled(id, true);

    await expect(callServerTool('S', 'delete_everything', {}, null)).rejects.toThrow(
      /MCP server "S" has no tool named "delete_everything"\. Its tools: search/,
    );
    expect(mockClient.callTool).not.toHaveBeenCalled();
  });

  it('throws for an unknown server name, listing the known ones', async () => {
    await addServer('S', stdioDescriptor);
    await expect(callServerTool('nope', 'do_thing', {}, null)).rejects.toThrow(/No MCP server named "nope".*S/);
  });

  it('throws when the server is configured but not connected', async () => {
    await addServer('S', stdioDescriptor);
    const id = await firstId();
    // `live` is module state, not reset between tests (unlike configStoreState) —
    // an id recycled from an earlier test's connected server would otherwise
    // leak a stale 'connected' entry here. Force-disconnect to start clean.
    await setServerEnabled(id, false);
    await expect(callServerTool('S', 'do_thing', {}, null)).rejects.toThrow(/not connected/);
  });

  it('throws on ambiguous duplicate server names', async () => {
    mcpClientMocks.connectMcpServer.mockResolvedValue(mockClient);
    await addServer('S', stdioDescriptor);
    await addServer('S', stdioDescriptor);
    await expect(callServerTool('S', 'do_thing', {}, null)).rejects.toThrow(/Multiple MCP servers are named "S"/);
  });
});
