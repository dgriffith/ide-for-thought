/**
 * IPC for the MCP Servers Settings UI (#2031): add/edit/remove a configured
 * server, toggle enabled (best-effort non-interactive connect), and an
 * explicit interactive connect that may pop a browser for OAuth (#2030).
 */
import { Channels } from '../../shared/channels';
import { handle } from './typed-ipc';
import {
  addServer,
  connectServer,
  listServerStatuses,
  removeServer,
  setServerEnabled,
  updateServer,
} from '../mcp-servers/registry';

export function registerMcpServers(): void {
  handle(Channels.MCP_SERVERS_LIST, () => listServerStatuses());

  handle(Channels.MCP_SERVERS_ADD, (_e, name, descriptor) => addServer(name, descriptor));

  handle(Channels.MCP_SERVERS_UPDATE, (_e, id, patch) => updateServer(id, patch));

  handle(Channels.MCP_SERVERS_REMOVE, (_e, id) => removeServer(id));

  handle(Channels.MCP_SERVERS_SET_ENABLED, (_e, id, enabled) => setServerEnabled(id, enabled));

  handle(Channels.MCP_SERVERS_CONNECT, (_e, id) => connectServer(id));
}
