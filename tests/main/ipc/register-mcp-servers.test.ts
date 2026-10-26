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
  ipcMain: { handle: (channel: string, fn: Handler) => { handlers.set(channel, fn); }, removeHandler: (channel: string) => { handlers.delete(channel); } },
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
  setLocalMcpServersOn: vi.fn(async () => {}),
}));
vi.mock('../../../src/main/mcp-servers/registry', () => registryMock);

const permissionsMock = vi.hoisted(() => ({
  resetAllowedTools: vi.fn(),
  configureMcpToolPermissionsPath: vi.fn(),
  serverIdentity: (d: unknown) => JSON.stringify(d),
}));
vi.mock('../../../src/main/mcp-servers/tool-permissions', () => permissionsMock);

import { registerLocalMcpServers, registerMcpServers } from '../../../src/main/ipc/register-mcp-servers';
import { Channels } from '../../../src/shared/channels';

registerMcpServers();
// Off means not wired up (#2891): the channels that run a program aren't
// there until the Local MCP servers plugin is on.
const localChannelsBeforeActivation = [Channels.MCP_SERVERS_ADD, Channels.MCP_SERVERS_UPDATE].filter((c) => handlers.has(c));
const stopLocal = registerLocalMcpServers();
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
    registryMock.listServerStatuses.mockResolvedValue([]);
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

  describe('a plugin\'s server (#2646)', () => {
    const pluginServer = (enabled: boolean) => ({
      id: 'plugin:word-tools/words', name: 'word-tools.words', enabled, status: 'disconnected', tools: [],
      descriptor: { kind: 'stdio', command: 'node', args: ['/p/word-tools/server/index.js'], cwd: '/p/word-tools', env: { TOKEN: 'tok-123' } },
      plugin: { id: 'word-tools', name: 'Word Tools', version: '1.0.0', title: 'Word counting', identity: 'h' },
    });

    it('turning it on asks natively, naming the plugin, its version and the program — never env values', async () => {
      registryMock.listServerStatuses.mockResolvedValue([pluginServer(false)]);
      registryMock.setServerEnabled.mockResolvedValue(['on']);
      await expect(handlers.get(Channels.MCP_SERVERS_SET_ENABLED)!({}, 'plugin:word-tools/words', true)).resolves.toEqual(['on']);
      const opts = dialogMock.showMessageBox.mock.calls[0]![0] as { message: string; detail: string };
      expect(opts.message).toBe('Let the Word Tools plugin run "word-tools.words" as an MCP server?');
      expect(opts.detail).toContain('node /p/word-tools/server/index.js');
      expect(opts.detail).toContain('in /p/word-tools');
      expect(opts.detail).toContain('with environment: TOKEN');
      expect(opts.detail).toContain('From Word Tools 1.0.0. A new version asks again.');
      expect(opts.detail).not.toContain('tok-123');
      expect(registryMock.setServerEnabled).toHaveBeenCalledWith('plugin:word-tools/words', true);
    });

    it('declined, it stays off', async () => {
      registryMock.listServerStatuses.mockResolvedValue([pluginServer(false)]);
      dialogMock.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });
      await handlers.get(Channels.MCP_SERVERS_SET_ENABLED)!({}, 'plugin:word-tools/words', true);
      expect(registryMock.setServerEnabled).not.toHaveBeenCalled();
    });

    it('turning it off, or a user server on, never asks', async () => {
      registryMock.listServerStatuses.mockResolvedValue([pluginServer(true), { id: 'u1', name: 'mine', enabled: false, descriptor: { kind: 'stdio', command: 'x' } }]);
      await handlers.get(Channels.MCP_SERVERS_SET_ENABLED)!({}, 'plugin:word-tools/words', false);
      await handlers.get(Channels.MCP_SERVERS_SET_ENABLED)!({}, 'u1', true);
      expect(dialogMock.showMessageBox).not.toHaveBeenCalled();
      expect(registryMock.setServerEnabled.mock.calls).toEqual([['plugin:word-tools/words', false], ['u1', true]]);
    });
  });
});

describe('Local MCP servers, a built-in plugin (#2891)', () => {
  it('adding or changing a local server has no channel until it is on, and none after it goes off', () => {
    expect(localChannelsBeforeActivation).toEqual([]);
    expect(handlers.has(Channels.MCP_SERVERS_ADD)).toBe(true);
    stopLocal();
    expect(handlers.has(Channels.MCP_SERVERS_ADD)).toBe(false);
    expect(handlers.has(Channels.MCP_SERVERS_UPDATE)).toBe(false);
    expect(registryMock.setLocalMcpServersOn).toHaveBeenCalledWith(false);
    const again = registerLocalMcpServers();
    expect(registryMock.setLocalMcpServersOn).toHaveBeenLastCalledWith(true);
    expect(handlers.has(Channels.MCP_SERVERS_ADD)).toBe(true);
    void again;
  });

  it('a remote server is added and changed through core channels, which refuse anything that runs a program', async () => {
    registryMock.addServer.mockResolvedValue(['the-list']);
    registryMock.updateServer.mockResolvedValue(['the-list']);
    const add = handlers.get(Channels.MCP_SERVERS_ADD_REMOTE)!;
    const update = handlers.get(Channels.MCP_SERVERS_UPDATE_REMOTE)!;
    await expect(add({}, 'Remote', { kind: 'http', url: 'https://mcp.example' })).resolves.toEqual(['the-list']);
    await expect(add({}, 'Local', { kind: 'stdio', command: 'node' })).rejects.toThrow('Only a remote (HTTP) server');
    await expect(update({}, 'r1', { name: 'Renamed', descriptor: { kind: 'http', url: 'https://mcp.example' } })).resolves.toEqual(['the-list']);
    await expect(update({}, 'r1', { descriptor: { kind: 'stdio', command: 'node' } })).rejects.toThrow('only be changed while Local MCP servers is on');
    storedMock.getStoredServers.mockResolvedValue([{ id: 's1', name: 'Local', enabled: true, descriptor: { kind: 'stdio', command: 'node' } }]);
    await expect(update({}, 's1', { name: 'Renamed' })).rejects.toThrow('only be changed while Local MCP servers is on');
    expect(registryMock.addServer).toHaveBeenCalledTimes(1);
    expect(registryMock.updateServer).toHaveBeenCalledTimes(1);
    expect(dialogMock.showMessageBox).not.toHaveBeenCalled();
  });
});

