/**
 * IPC for the MCP Servers Settings UI (#2031): add/edit/remove a configured
 * server, toggle enabled (best-effort non-interactive connect), and an
 * explicit interactive connect that may pop a browser for OAuth (#2030), and
 * revoking the "Don't ask again" grants of the mcp_call confirmation (#2439).
 */
import path from 'node:path';
import { app } from 'electron';
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
import { configureMcpToolPermissionsPath, resetAllowedTools } from '../mcp-servers/tool-permissions';

export function registerMcpServers(): void {
  // Per MACHINE, never per thoughtbase (#2439): a synced thoughtbase must not
  // be able to pre-authorize a write tool. See `tool-permissions.ts`.
  configureMcpToolPermissionsPath(path.join(app.getPath('userData'), 'mcp-tool-permissions.json'));

  handle(Channels.MCP_SERVERS_LIST, () => listServerStatuses());

  handle(Channels.MCP_SERVERS_ADD, (_e, name, descriptor) => addServer(name, descriptor));

  handle(Channels.MCP_SERVERS_UPDATE, (_e, id, patch) => updateServer(id, patch));

  handle(Channels.MCP_SERVERS_REMOVE, (_e, id) => removeServer(id));

  handle(Channels.MCP_SERVERS_SET_ENABLED, (_e, id, enabled) => setServerEnabled(id, enabled));

  handle(Channels.MCP_SERVERS_CONNECT, (_e, id) => connectServer(id));

  // Settings → MCP "Reset allowed MCP tools" (#2439): forget every
  // "Don't ask again" grant, so every non-read-only tool asks again.
  handle(Channels.MCP_SERVERS_RESET_ALLOWED_TOOLS, () => resetAllowedTools());
}
