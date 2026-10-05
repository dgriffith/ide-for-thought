/**
 * MCP Servers IPC handler coverage (#2031) — each channel just delegates to
 * `registry.ts` with the right arguments; that module's own status-transition
 * logic is covered separately in `tests/main/mcp-servers/registry.test.ts`.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

type Handler = (event: unknown, ...args: unknown[]) => unknown;
const handlers = vi.hoisted(() => new Map<string, Handler>());
// Main's native confirm (#2568): "Allow" unless a test says otherwise.
const dialogMock = vi.hoisted(() => ({ showMessageBox: vi.fn() }));
const storedMock = vi.hoisted(() => ({ getStoredServers: vi.fn() }));

vi.mock('electron', () => ({
  ipcMain: { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); } },
  app: { getPath: () => '/fake-user-data' },
  dialog: dialogMock,
}));
vi.mock('../../../src/main/ipc/helpers', () => ({ winFromEvent: () => null }));
vi.mock('../../../src/main/mcp-servers/config-store', () => storedMock);

const registryMock = vi.hoisted(() => ({
  listServerStatuses: vi.fn(),
  addServer: vi.fn(),
  updateServer: vi.fn(),
  removeServer: vi.fn(),
  setServerEnabled: vi.fn(),
  connectServer: vi.fn(),
}));
vi.mock('../../../src/main/mcp-servers/registry', () => registryMock);

const permissionsMock = vi.hoisted(() => ({
  resetAllowedTools: vi.fn(),
  configureMcpToolPermissionsPath: vi.fn(),
  serverIdentity: (d: unknown) => JSON.stringify(d),
}));
vi.mock('../../../src/main/mcp-servers/tool-permissions', () => permissionsMock);

import { registerMcpServers } from '../../../src/main/ipc/register-mcp-servers';
import { Channels } from '../../../src/shared/channels';

registerMcpServers();
// Captured before beforeEach's clearAllMocks wipes the call record.
const configuredPermissionsPath = permissionsMock.configureMcpToolPermissionsPath.mock.calls[0]?.[0];

beforeEach(() => {
  vi.clearAllMocks();
  dialogMock.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false });
  storedMock.getStoredServers.mockResolvedValue([]);
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

  it('MCP_SERVERS_RESET_ALLOWED_TOOLS clears the "Don\'t ask again" grants and returns the count (#2439)', async () => {
    permissionsMock.resetAllowedTools.mockReturnValue(3);
    const h = handlers.get(Channels.MCP_SERVERS_RESET_ALLOWED_TOOLS)!;
    await expect(Promise.resolve(h({}))).resolves.toBe(3);
    expect(permissionsMock.resetAllowedTools).toHaveBeenCalledWith();
  });

  it('points the "Don\'t ask again" store at userData, never at a thoughtbase (#2439)', () => {
    expect(configuredPermissionsPath).toBe('/fake-user-data/mcp-tool-permissions.json');
  });
});

describe('stdio servers need main\'s native confirm (#2568)', () => {
  const stdio = { kind: 'stdio', command: 'npx', args: ['-y', 'some server'], env: { API_KEY: 'secret-value' } };

  it('ADD shows the exact command (env names, never values); Allow adds it', async () => {
    registryMock.addServer.mockResolvedValue(['added']);
    await expect(handlers.get(Channels.MCP_SERVERS_ADD)!({}, 'S', stdio)).resolves.toEqual(['added']);
    const opts = dialogMock.showMessageBox.mock.calls[0]![0] as { detail: string; buttons: string[] };
    expect(opts.detail).toContain("npx -y 'some server'");
    expect(opts.detail).toContain('API_KEY');
    expect(opts.detail).not.toContain('secret-value');
    expect(opts.buttons[0]).toBe('Allow');
  });

  it('ADD declined saves nothing and returns the unchanged list', async () => {
    dialogMock.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });
    registryMock.listServerStatuses.mockResolvedValue(['unchanged']);
    await expect(handlers.get(Channels.MCP_SERVERS_ADD)!({}, 'S', stdio)).resolves.toEqual(['unchanged']);
    expect(registryMock.addServer).not.toHaveBeenCalled();
  });

  it('an http server needs no confirm (Minerva runs no program for it)', async () => {
    registryMock.addServer.mockResolvedValue(['added']);
    await handlers.get(Channels.MCP_SERVERS_ADD)!({}, 'H', { kind: 'http', url: 'https://mcp.example.com/mcp' });
    expect(dialogMock.showMessageBox).not.toHaveBeenCalled();
  });

  it('UPDATE asks only when the program changes, not for a rename', async () => {
    storedMock.getStoredServers.mockResolvedValue([{ id: 'a', name: 'S', enabled: true, descriptor: stdio }]);
    registryMock.updateServer.mockResolvedValue(['ok']);
    await handlers.get(Channels.MCP_SERVERS_UPDATE)!({}, 'a', { name: 'Renamed', descriptor: stdio });
    expect(dialogMock.showMessageBox).not.toHaveBeenCalled();

    dialogMock.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });
    registryMock.listServerStatuses.mockResolvedValue(['unchanged']);
    const changed = { ...stdio, command: '/tmp/evil' };
    await expect(handlers.get(Channels.MCP_SERVERS_UPDATE)!({}, 'a', { descriptor: changed })).resolves.toEqual(['unchanged']);
    expect(registryMock.updateServer).toHaveBeenCalledTimes(1); // only the rename
  });
});
