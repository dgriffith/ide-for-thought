/**
 * @vitest-environment happy-dom
 *
 * Render coverage for McpServersSettings (#2031). Mocks only
 * `api.mcpServers.*` — `getSettingsStore()`'s passthrough methods import the
 * same `api` from `ipc/client`, so mocking that one module is enough to
 * exercise the real store code, exactly like SkillsSettings.test.ts does for
 * `api.skills.*`.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, fireEvent, cleanup, waitFor } from '@testing-library/svelte';
import type { McpServerStatus } from '../../../src/shared/mcp-servers';

const { listMock, addMock, updateMock, removeMock, setEnabledMock, connectMock } = vi.hoisted(() => ({
  listMock: vi.fn(),
  addMock: vi.fn(),
  updateMock: vi.fn(),
  removeMock: vi.fn(),
  setEnabledMock: vi.fn(),
  connectMock: vi.fn(),
}));

vi.mock('../../../src/renderer/lib/ipc/client', () => ({
  api: {
    mcpServers: {
      list: listMock,
      add: addMock,
      update: updateMock,
      remove: removeMock,
      setEnabled: setEnabledMock,
      connect: connectMock,
    },
  },
}));

import McpServersSettings from '../../../src/renderer/lib/components/McpServersSettings.svelte';

function server(over: Partial<McpServerStatus> & Pick<McpServerStatus, 'id' | 'name'>): McpServerStatus {
  return {
    enabled: false,
    descriptor: { kind: 'stdio', command: 'npx' },
    status: 'disconnected',
    tools: [],
    ...over,
  };
}

afterEach(() => {
  cleanup();
  [listMock, addMock, updateMock, removeMock, setEnabledMock, connectMock].forEach((m) => m.mockReset());
});

describe('McpServersSettings (#2031)', () => {
  it('loads and renders the server list on mount', async () => {
    listMock.mockResolvedValue([
      server({ id: 'a', name: 'Local tool', status: 'connected', enabled: true }),
      server({ id: 'b', name: 'Remote tool', descriptor: { kind: 'http', url: 'https://x.example.com/mcp' } }),
    ]);
    const { findByText, getByText } = render(McpServersSettings, {});
    expect(await findByText('Local tool')).toBeTruthy();
    expect(getByText('Remote tool')).toBeTruthy();
  });

  it('shows an empty-state hint with no configured servers', async () => {
    listMock.mockResolvedValue([]);
    const { findByText } = render(McpServersSettings, {});
    expect(await findByText('No MCP servers configured yet.')).toBeTruthy();
  });

  it('toggling the enable checkbox calls api.mcpServers.setEnabled and reloads', async () => {
    listMock.mockResolvedValue([server({ id: 'a', name: 'Local tool' })]);
    setEnabledMock.mockResolvedValue([server({ id: 'a', name: 'Local tool', enabled: true })]);
    const { findByText, getByRole } = render(McpServersSettings, {});
    await findByText('Local tool');

    await fireEvent.click(getByRole('checkbox'));
    await waitFor(() => expect(setEnabledMock).toHaveBeenCalledWith('a', true));
    await waitFor(() => expect(listMock).toHaveBeenCalledTimes(2)); // initial + post-mutation reload
  });

  it('adding a stdio server submits the right descriptor and reloads', async () => {
    listMock.mockResolvedValue([]);
    addMock.mockResolvedValue([server({ id: 'new', name: 'New server' })]);
    const { findByText, getByText, getByPlaceholderText } = render(McpServersSettings, {});
    await findByText('MCP Servers');

    await fireEvent.click(getByText('Add server…'));
    await fireEvent.input(getByPlaceholderText('My server'), { target: { value: 'New server' } });
    await fireEvent.input(getByPlaceholderText('npx'), { target: { value: 'npx' } });
    await fireEvent.click(getByText('Add'));

    await waitFor(() => expect(addMock).toHaveBeenCalledWith('New server', { kind: 'stdio', command: 'npx' }));
  });

  it('adding a remote server submits an http descriptor', async () => {
    listMock.mockResolvedValue([]);
    addMock.mockResolvedValue([server({ id: 'new', name: 'Remote' })]);
    const { findByText, getByText, getByPlaceholderText, getByLabelText } = render(McpServersSettings, {});
    await findByText('MCP Servers');

    await fireEvent.click(getByText('Add server…'));
    await fireEvent.input(getByPlaceholderText('My server'), { target: { value: 'Remote' } });
    await fireEvent.click(getByLabelText('Remote URL'));
    await fireEvent.input(getByPlaceholderText('https://example.com/mcp'), { target: { value: 'https://x.example.com/mcp' } });
    await fireEvent.click(getByText('Add'));

    await waitFor(() => expect(addMock).toHaveBeenCalledWith('Remote', { kind: 'http', url: 'https://x.example.com/mcp' }));
  });

  it('shows a validation error and does not submit when the command/url is blank', async () => {
    listMock.mockResolvedValue([]);
    const { findByText, getByText, getByPlaceholderText } = render(McpServersSettings, {});
    await findByText('MCP Servers');

    await fireEvent.click(getByText('Add server…'));
    await fireEvent.input(getByPlaceholderText('My server'), { target: { value: 'No command' } });
    await fireEvent.click(getByText('Add'));

    expect(await findByText(/required/)).toBeTruthy();
    expect(addMock).not.toHaveBeenCalled();
  });

  it('Edit pre-fills the form, and Save calls api.mcpServers.update', async () => {
    listMock.mockResolvedValue([server({
      id: 'a', name: 'Original', descriptor: { kind: 'stdio', command: 'npx', args: ['-y', 'thing'] },
    })]);
    updateMock.mockResolvedValue([server({ id: 'a', name: 'Renamed' })]);
    const { findByText, getByText, getByDisplayValue } = render(McpServersSettings, {});
    await findByText('Original');

    await fireEvent.click(getByText('Edit'));
    expect(getByDisplayValue('Original')).toBeTruthy();
    expect(getByDisplayValue('npx')).toBeTruthy();

    await fireEvent.input(getByDisplayValue('Original'), { target: { value: 'Renamed' } });
    await fireEvent.click(getByText('Save'));

    await waitFor(() => expect(updateMock).toHaveBeenCalledWith('a', {
      name: 'Renamed',
      descriptor: { kind: 'stdio', command: 'npx', args: ['-y', 'thing'] },
    }));
  });

  it('Remove calls api.mcpServers.remove with the id', async () => {
    listMock.mockResolvedValue([server({ id: 'a', name: 'Local tool' })]);
    removeMock.mockResolvedValue([]);
    const { findByText, getByText } = render(McpServersSettings, {});
    await findByText('Local tool');

    await fireEvent.click(getByText('Remove'));
    await waitFor(() => expect(removeMock).toHaveBeenCalledWith('a'));
  });

  it('shows Connect only for an enabled, not-yet-connected server, and it calls api.mcpServers.connect', async () => {
    // connectRow() re-fetches via list() after the connect mutation — so the
    // SECOND list() call (the post-connect reload) is what must reflect the
    // now-connected status, not the connect mutation's own return value.
    listMock
      .mockResolvedValueOnce([server({ id: 'a', name: 'Needs auth', enabled: true, status: 'needs-auth' })])
      .mockResolvedValueOnce([server({ id: 'a', name: 'Needs auth', enabled: true, status: 'connected' })]);
    connectMock.mockResolvedValue([]);
    const { findByText, getByText, queryByText } = render(McpServersSettings, {});
    await findByText('Needs auth');

    expect(getByText('Connect')).toBeTruthy();
    await fireEvent.click(getByText('Connect'));
    await waitFor(() => expect(connectMock).toHaveBeenCalledWith('a'));
    await waitFor(() => expect(queryByText('Connect')).toBeNull()); // now connected
  });

  it('does not show Connect for a disabled server', async () => {
    listMock.mockResolvedValue([server({ id: 'a', name: 'Disabled', enabled: false, status: 'disconnected' })]);
    const { findByText, queryByText } = render(McpServersSettings, {});
    await findByText('Disabled');
    expect(queryByText('Connect')).toBeNull();
  });

  it('shows the tool list once connected', async () => {
    listMock.mockResolvedValue([server({
      id: 'a', name: 'Connected server', enabled: true, status: 'connected',
      tools: [{ name: 'search', description: 'search things', inputSchema: { type: 'object' } }],
    })]);
    const { findByText } = render(McpServersSettings, {});
    await findByText('Connected server');
    expect(await findByText('1 tool')).toBeTruthy();
    expect(await findByText('search')).toBeTruthy();
  });

  it('surfaces a mutation error in the banner', async () => {
    listMock.mockResolvedValue([server({ id: 'a', name: 'Local tool' })]);
    removeMock.mockRejectedValue(new Error('remove failed'));
    const { findByText, getByText } = render(McpServersSettings, {});
    await findByText('Local tool');
    await fireEvent.click(getByText('Remove'));
    expect(await findByText('remove failed')).toBeTruthy();
  });
});
