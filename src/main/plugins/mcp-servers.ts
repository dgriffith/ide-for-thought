/**
 * The MCP servers enabled plugins ship (#2646), as the MCP registry needs
 * them: where the program is, what it's started with, and what the user has
 * approved. The registry (`mcp-servers/registry.ts`) owns connecting; this
 * module only reads the plugins and records approvals, so the dependency
 * runs one way, mcp-servers → plugins.
 *
 * A server is described twice. **Declared**: what `plugin.json` says, with
 * `${settings.*}` left as written — what the user approves, and what
 * "don't ask again" for its tools is keyed on, with the plugin's version.
 * **Resolved**: the same with the settings' values filled in — what runs.
 * So a new plugin version, or a changed declaration, asks again; a changed
 * API token in the plugin's settings only reconnects.
 */
import path from 'node:path';
import type { McpServerDescriptor } from '../../shared/mcp-servers';
import type { PluginOrigin } from '../../shared/plugins/format';
import { activePluginsDir, getPluginScan } from './registry';
import { loadPluginRecords, recordFor, updatePluginRecords } from './state';
import { pluginSettingsForServer } from './settings';
import { isInterpreter } from './mcp-schema';

type Stdio = Extract<McpServerDescriptor, { kind: 'stdio' }>;

export interface PluginServerDecl {
  /** `plugin:<plugin id>/<key>`: the registry's id, never a stored server's UUID. */
  id: string;
  /** `<plugin id>.<key>`: the name the model calls it by and Settings shows. */
  name: string;
  title: string;
  key: string;
  plugin: PluginOrigin;
  /** `plugin:<id>@<version>`. */
  provenance: string;
  declared: Stdio;
  resolved: Stdio;
  /** The identity the user approved, if any. */
  approved?: string;
}

export const PLUGIN_SERVER_PREFIX = 'plugin:';

export function isPluginServerId(id: string): boolean {
  return id.startsWith(PLUGIN_SERVER_PREFIX);
}

function parseId(id: string): { plugin: string; key: string } | null {
  const m = /^plugin:([a-z][a-z0-9-]*)\/([A-Za-z0-9][A-Za-z0-9_-]*)$/.exec(id);
  return m ? { plugin: m[1]!, key: m[2]! } : null;
}

/** The enabled plugins' servers. */
export async function pluginServerDecls(): Promise<PluginServerDecl[]> {
  const dir = activePluginsDir();
  const scan = await getPluginScan();
  const records = await loadPluginRecords(dir);
  const out: PluginServerDecl[] = [];
  for (const plugin of scan.plugins) {
    const m = plugin.manifest;
    if (!m.mcpServers?.length) continue;
    const settings = pluginSettingsForServer(dir, m);
    const approvals = recordFor(records, m.id).mcpApproved ?? {};
    for (const s of m.mcpServers) {
      const file = (rel: string) => path.join(plugin.root, ...rel.split('/'));
      const command = isInterpreter(s.command) ? s.command : file(s.command);
      const args = isInterpreter(s.command) ? [file(s.args[0]!), ...s.args.slice(1)] : s.args;
      const declared: Stdio = { kind: 'stdio', command, args, env: s.env, cwd: plugin.root };
      const env = Object.fromEntries(Object.entries(s.env).map(([k, v]) => [k, v.replace(/\$\{settings\.([A-Za-z][A-Za-z0-9_]*)\}/g, (_x, key: string) => settings[key] ?? '')]));
      out.push({
        id: `${PLUGIN_SERVER_PREFIX}${m.id}/${s.key}`,
        name: `${m.id}.${s.key}`,
        title: s.title,
        key: s.key,
        plugin: { id: m.id, name: m.name, version: m.version },
        provenance: plugin.provenance,
        declared,
        resolved: { ...declared, env },
        ...(approvals[s.key] ? { approved: approvals[s.key] } : {}),
      });
    }
  }
  return out;
}

/** Record (an identity) or withdraw (null) the user's approval of one plugin server. */
export async function setPluginServerApproval(id: string, identity: string | null): Promise<void> {
  const parsed = parseId(id);
  if (!parsed) throw new Error(`"${id}" isn't a plugin's MCP server.`);
  await updatePluginRecords(activePluginsDir(), (records) => {
    const rec = recordFor(records, parsed.plugin);
    const approved = { ...rec.mcpApproved };
    if (identity === null) delete approved[parsed.key];
    else approved[parsed.key] = identity;
    const { mcpApproved: _old, ...rest } = rec;
    records[parsed.plugin] = { ...rest, ...(Object.keys(approved).length > 0 ? { mcpApproved: approved } : {}) };
  });
}
