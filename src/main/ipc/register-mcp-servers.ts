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
import { configureMcpToolPermissionsPath, resetAllowedTools, serverIdentity } from '../mcp-servers/tool-permissions';
import { getStoredServers } from '../mcp-servers/config-store';
import { confirmNative } from '../native-confirm';
import { winFromEvent } from './helpers';
import type { BrowserWindow } from 'electron';
import type { McpServerDescriptor } from '../../shared/mcp-servers';

export function registerMcpServers(): void {
  // Per MACHINE, never per thoughtbase (#2439): a synced thoughtbase must not
  // be able to pre-authorize a write tool. See `tool-permissions.ts`.
  configureMcpToolPermissionsPath(path.join(app.getPath('userData'), 'mcp-tool-permissions.json'));

  handle(Channels.MCP_SERVERS_LIST, () => listServerStatuses());

  // A stdio server is a program Minerva will run (#2568): adding one, or
  // changing what one runs, is confirmed by main's own dialog showing the exact
  // command — the renderer can't draw or answer it. Declined → nothing saved.
  handle(Channels.MCP_SERVERS_ADD, async (e, name, descriptor) => {
    if (descriptor.kind === 'stdio' && !(await confirmStdioServer(winFromEvent(e), name, descriptor))) {
      return listServerStatuses();
    }
    return addServer(name, descriptor);
  });

  handle(Channels.MCP_SERVERS_UPDATE, async (e, id, patch) => {
    const next = patch.descriptor;
    if (next?.kind === 'stdio') {
      const before = (await getStoredServers()).find((s) => s.id === id);
      const changed = !before || serverIdentity(before.descriptor) !== serverIdentity(next);
      if (changed && !(await confirmStdioServer(winFromEvent(e), patch.name ?? before?.name ?? 'MCP server', next))) {
        return listServerStatuses();
      }
    }
    return updateServer(id, patch);
  });

  handle(Channels.MCP_SERVERS_REMOVE, (_e, id) => removeServer(id));

  handle(Channels.MCP_SERVERS_SET_ENABLED, (_e, id, enabled) => setServerEnabled(id, enabled));

  handle(Channels.MCP_SERVERS_CONNECT, (_e, id) => connectServer(id));

  // Settings → MCP "Reset allowed MCP tools" (#2439): forget every
  // "Don't ask again" grant, so every non-read-only tool asks again.
  handle(Channels.MCP_SERVERS_RESET_ALLOWED_TOOLS, () => resetAllowedTools());
}

/** Shell-ish quoting for display only. */
function displayArg(a: string): string {
  return /^[\w@%+=:,./-]+$/.test(a) ? a : `'${a.replace(/'/g, `'\\''`)}'`;
}

async function confirmStdioServer(
  win: BrowserWindow | null,
  name: string,
  d: Extract<McpServerDescriptor, { kind: 'stdio' }>,
): Promise<boolean> {
  const lines = [
    [d.command, ...(d.args ?? [])].map(displayArg).join(' '),
    ...(d.cwd ? [`in ${d.cwd}`] : []),
    // Names only — a value is often an API key.
    ...(d.env && Object.keys(d.env).length > 0 ? [`with environment: ${Object.keys(d.env).join(', ')}`] : []),
  ];
  const answer = await confirmNative(win, {
    message: `Let Minerva run "${name}" as an MCP server?`,
    detail: `It starts this program on your machine, with your permissions:\n\n${lines.join('\n')}`,
    confirmLabel: 'Allow',
  });
  return answer.confirmed;
}
