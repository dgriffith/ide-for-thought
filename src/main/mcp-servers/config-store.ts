/**
 * Persistence for configured MCP servers (#2031). Stored as
 * `~/.minerva/mcp-servers.json` — per-user, not per-thoughtbase (matches
 * the OAuth token store's own precedent, #2030: `McpServerDescriptor`
 * identity isn't thoughtbase-scoped). No electron dependency, unlike the
 * `userData/`-rooted OAuth token store — this file lives entirely under the
 * user's home directory.
 *
 * `getStoredServers` (display, and the registry's connect paths) goes through
 * `loadConfigFile` (`../config/config-store.ts`), so a missing file is
 * silent-defaults and a corrupt one is loud-logged-defaults, per CLAUDE.md's
 * Config files convention. Every mutation reads STRICTLY instead (#2416): built
 * on those defaults, adding one server would erase the rest, so a corrupt file
 * makes the mutation throw and stays as it was. Writes go through
 * `writeJsonFileAtomic` (`../config/json-file.ts`, #2369), so a crash mid-save
 * can't leave a truncated file behind.
 *
 * Mutations are serialized per file (`withFileLock`). This header used to argue
 * no lock was needed because "mutations here come from one user in one settings
 * panel". That named who mutates, but the hazard is overlap, and one user
 * produces overlap: Electron runs each `invoke` handler as it arrives, so two
 * quick toggles, or the same panel open in two windows, give two
 * read-modify-writes whose `await`s interleave, and the second write drops the
 * first. The lock costs nothing when there is no contention.
 */
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { asBool, asRecord, asString, asStringArray, loadConfigFile, loadConfigFileStrict, requireRecord } from '../config/config-store';
import { withFileLock } from '../config/file-lock';
import { writeJsonFileAtomic } from '../config/json-file';
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
  const list = requireRecord(raw, 'mcp-servers.json').servers;
  if (list !== undefined && !Array.isArray(list)) throw new Error('"servers" is not an array');
  return Array.isArray(list)
    ? list.map(decodeServer).filter((s): s is StoredMcpServerConfig => s !== null)
    : [];
}

/** `file` is injectable for tests (mirrors `menu-config-store.ts`'s
 *  `saveMenuConfig(config, file = menuConfigPath())` convention) — real
 *  callers never pass it. LENIENT: never build a write from this. */
export function getStoredServers(file: string = mcpServersConfigPath()): Promise<StoredMcpServerConfig[]> {
  return loadConfigFile(() => file, decode, []);
}

/**
 * The one read-modify-write path: strict read, `fn`, atomic write, all under
 * the file's lock. `fn` returns the list to write, or `null` to write nothing.
 */
function mutateServers<T>(
  file: string,
  fn: (servers: StoredMcpServerConfig[]) => { next: StoredMcpServerConfig[] | null; result: T },
): Promise<T> {
  return withFileLock(file, async () => {
    const servers = await loadConfigFileStrict(file, decode, []);
    const { next, result } = fn(servers);
    if (next) await writeJsonFileAtomic(file, { servers: next }, { trailingNewline: true });
    return result;
  });
}

function mutateOne(
  id: string,
  fn: (server: StoredMcpServerConfig) => StoredMcpServerConfig,
  file: string,
): Promise<StoredMcpServerConfig | null> {
  return mutateServers(file, (servers) => {
    let updated: StoredMcpServerConfig | null = null;
    const next = servers.map((s) => {
      if (s.id !== id) return s;
      updated = fn(s);
      return updated;
    });
    return { next: updated ? next : null, result: updated };
  });
}

export function addStoredServer(
  name: string,
  descriptor: McpServerDescriptor,
  file: string = mcpServersConfigPath(),
): Promise<StoredMcpServerConfig> {
  const server: StoredMcpServerConfig = { id: crypto.randomUUID(), name, enabled: false, descriptor };
  return mutateServers(file, (servers) => ({ next: [...servers, server], result: server }));
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

export function removeStoredServer(id: string, file: string = mcpServersConfigPath()): Promise<void> {
  return mutateServers(file, (servers) => ({ next: servers.filter((s) => s.id !== id), result: undefined }));
}
