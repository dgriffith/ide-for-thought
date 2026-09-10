/**
 * Persistence for configured MCP servers (#2031). Stored as
 * `~/.minerva/mcp-servers.json` — per-user, not per-thoughtbase (matches
 * the OAuth token store's own precedent, #2030: `McpServerDescriptor`
 * identity isn't thoughtbase-scoped). No electron dependency, unlike the
 * `userData/`-rooted OAuth token store — this file lives entirely under the
 * user's home directory.
 *
 * Reads go through `loadConfigFile` (`../config/config-store.ts`) so a
 * missing file is silent-defaults and a corrupt one is loud-logged-defaults,
 * per CLAUDE.md's Config files convention. Writes are hand-rolled — that
 * module only centralizes reads (no shared save helper exists to route
 * through), matching `token-store.ts`/`menu-config-store.ts`. No write lock:
 * mutations here come from one user in one settings panel, not from several
 * concurrent completions the way OAuth callbacks can.
 */
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { asBool, asRecord, asString, asStringArray, loadConfigFile } from '../config/config-store';
import type { McpServerDescriptor, StoredMcpServerConfig } from '../../shared/mcp-servers';

export function mcpServersConfigPath(): string {
  return path.join(os.homedir(), '.minerva', 'mcp-servers.json');
}

function decodeDescriptor(raw: unknown): McpServerDescriptor | null {
  const o = asRecord(raw);
  if (o.kind === 'stdio') {
    const command = asString(o.command, '');
    if (!command) return null;
    const descriptor: Extract<McpServerDescriptor, { kind: 'stdio' }> = { kind: 'stdio', command };
    const args = asStringArray(o.args, []);
    if (args.length > 0) descriptor.args = args;
    const envEntries = Object.entries(asRecord(o.env)).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
    if (envEntries.length > 0) descriptor.env = Object.fromEntries(envEntries);
    const cwd = asString(o.cwd, '');
    if (cwd) descriptor.cwd = cwd;
    return descriptor;
  }
  if (o.kind === 'http') {
    const url = asString(o.url, '');
    return url ? { kind: 'http', url } : null;
  }
  return null;
}

function decodeServer(raw: unknown): StoredMcpServerConfig | null {
  const o = asRecord(raw);
  const id = asString(o.id, '');
  const name = asString(o.name, '');
  const descriptor = decodeDescriptor(o.descriptor);
  // A record missing any of these is useless — drop it rather than hand
  // back a half-formed entry the registry can't act on.
  if (!id || !name || !descriptor) return null;
  return { id, name, enabled: asBool(o.enabled, false), descriptor };
}

function decode(raw: unknown): StoredMcpServerConfig[] {
  const list = asRecord(raw).servers;
  return Array.isArray(list)
    ? list.map(decodeServer).filter((s): s is StoredMcpServerConfig => s !== null)
    : [];
}

/** `file` is injectable for tests (mirrors `menu-config-store.ts`'s
 *  `saveMenuConfig(config, file = menuConfigPath())` convention) — real
 *  callers never pass it. */
export function getStoredServers(file: string = mcpServersConfigPath()): Promise<StoredMcpServerConfig[]> {
  return loadConfigFile(() => file, decode, []);
}

async function writeStoredServers(servers: StoredMcpServerConfig[], file: string): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, JSON.stringify({ servers }, null, 2) + '\n', 'utf-8');
}

async function mutateOne(
  id: string,
  fn: (server: StoredMcpServerConfig) => StoredMcpServerConfig,
  file: string,
): Promise<StoredMcpServerConfig | null> {
  const servers = await getStoredServers(file);
  let updated: StoredMcpServerConfig | null = null;
  const next = servers.map((s) => {
    if (s.id !== id) return s;
    updated = fn(s);
    return updated;
  });
  if (!updated) return null;
  await writeStoredServers(next, file);
  return updated;
}

export async function addStoredServer(
  name: string,
  descriptor: McpServerDescriptor,
  file: string = mcpServersConfigPath(),
): Promise<StoredMcpServerConfig> {
  const server: StoredMcpServerConfig = { id: crypto.randomUUID(), name, enabled: false, descriptor };
  const servers = await getStoredServers(file);
  await writeStoredServers([...servers, server], file);
  return server;
}

export interface StoredMcpServerPatch {
  name?: string;
  descriptor?: McpServerDescriptor;
}

export function updateStoredServer(
  id: string,
  patch: StoredMcpServerPatch,
  file: string = mcpServersConfigPath(),
): Promise<StoredMcpServerConfig | null> {
  return mutateOne(id, (s) => ({ ...s, ...patch }), file);
}

export function setStoredServerEnabled(
  id: string,
  enabled: boolean,
  file: string = mcpServersConfigPath(),
): Promise<StoredMcpServerConfig | null> {
  return mutateOne(id, (s) => ({ ...s, enabled }), file);
}

export async function removeStoredServer(id: string, file: string = mcpServersConfigPath()): Promise<void> {
  const servers = await getStoredServers(file);
  await writeStoredServers(servers.filter((s) => s.id !== id), file);
}
