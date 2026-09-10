/**
 * MCP Servers IPC handler coverage (#2031) — each channel just delegates to
 * `registry.ts` with the right arguments; that module's own status-transition
 * logic is covered separately in `tests/main/mcp-servers/registry.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = vi.hoisted(() => new Map<string, Handler>());

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } },
}));

const registryMock = vi.hoisted(() => ({
  listServerStatuses: vi.fn(),
  addServer: vi.fn(),
  updateServer: vi.fn(),
  removeServer: vi.fn(),
  setServerEnabled: vi.fn(),
  connectServer: vi.fn(),
}));
vi.mock('../../../src/main/mcp-servers/registry', () => registryMock);

import { registerMcpServers } from '../../../src/main/ipc/register-mcp-servers';
import { Channels } from '../../../src/shared/channels';

registerMcpServers();

beforeEach(() => {
  vi.clearAllMocks();
});

describe('registerMcpServers', () => {
  it('MCP_SERVERS_LIST delegates to listServerStatuses()', async () => {
    registryMock.listServerStatuses.mockResolvedValue(['the-list']);
    const h = handlers.get(Channels.MCP_SERVERS_LIST)!;
    await expect(h({})).resolves.toEqual(['the-list']);
    expect(registryMock.listServerStatuses).toHaveBeenCalledWith();
  });

  it('MCP_SERVERS_ADD delegates to addServer(name, descriptor)', async () => {
    const descriptor = { kind: 'stdio', command: 'npx' };
    registryMock.addServer.mockResolvedValue(['the-list']);
    const h = handlers.get(Channels.MCP_SERVERS_ADD)!;
    await expect(h({}, 'My server', descriptor)).resolves.toEqual(['the-list']);
    expect(registryMock.addServer).toHaveBeenCalledWith('My server', descriptor);
  });

  it('MCP_SERVERS_UPDATE delegates to updateServer(id, patch)', async () => {
    const patch = { name: 'Renamed' };
    registryMock.updateServer.mockResolvedValue(['the-list']);
    const h = handlers.get(Channels.MCP_SERVERS_UPDATE)!;
    await expect(h({}, 'id-1', patch)).resolves.toEqual(['the-list']);
    expect(registryMock.updateServer).toHaveBeenCalledWith('id-1', patch);
  });

  it('MCP_SERVERS_REMOVE delegates to removeServer(id)', async () => {
    registryMock.removeServer.mockResolvedValue(['the-list']);
    const h = handlers.get(Channels.MCP_SERVERS_REMOVE)!;
    await expect(h({}, 'id-1')).resolves.toEqual(['the-list']);
    expect(registryMock.removeServer).toHaveBeenCalledWith('id-1');
  });

  it('MCP_SERVERS_SET_ENABLED delegates to setServerEnabled(id, enabled)', async () => {
    registryMock.setServerEnabled.mockResolvedValue(['the-list']);
    const h = handlers.get(Channels.MCP_SERVERS_SET_ENABLED)!;
    await expect(h({}, 'id-1', true)).resolves.toEqual(['the-list']);
    expect(registryMock.setServerEnabled).toHaveBeenCalledWith('id-1', true);
  });

  it('MCP_SERVERS_CONNECT delegates to connectServer(id)', async () => {
    registryMock.connectServer.mockResolvedValue(['the-list']);
    const h = handlers.get(Channels.MCP_SERVERS_CONNECT)!;
    await expect(h({}, 'id-1')).resolves.toEqual(['the-list']);
    expect(registryMock.connectServer).toHaveBeenCalledWith('id-1');
  });
});
