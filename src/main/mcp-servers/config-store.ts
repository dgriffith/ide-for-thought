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
 *
 * ── stdio `env` values are secrets (#2562) ─────────────────────────────────
 * A server's `env` is where its API key goes, so each value is stored
 * `encryptSecret`-ed (`enc:v1:…`, OS keychain via safeStorage) and the file is
 * written 0600. The lenient read DECRYPTS (it feeds connecting and the
 * settings form). A mutation does NOT: it reads every value exactly as stored
 * and writes the untouched servers back verbatim, encrypting only values that
 * aren't yet — because `decryptSecret` answers `''` when the keychain can't
 * decrypt, and decode-then-re-encode would quietly blank every other server's
 * key on an unrelated toggle (the same trap `mcp-oauth/token-store.ts` names).
 * Legacy plaintext files still load; their values are encrypted on the next
 * write, and a load that finds any schedules that write itself.
 */
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { asBool, asRecord, asString, asStringArray, loadConfigFile, loadConfigFileStrict, requireRecord } from '../config/config-store';
import { withFileLock } from '../config/file-lock';
import { writeJsonFileAtomic, SECRET_FILE_MODE } from '../config/json-file';
import { decryptSecret, encryptSecret, isEncrypted, secretEncryptionAvailable } from '../secret-storage';
import { logger } from '../../shared/logger';
import type { McpServerDescriptor, StoredMcpServerConfig } from '../../shared/mcp-servers';

export function mcpServersConfigPath(): string {
  return path.join(os.homedir(), '.minerva', 'mcp-servers.json');
}

/** How an env value is read: decrypted for use, or kept as stored for a write. */
type EnvValueDecoder = (stored: string) => string;
const asStored: EnvValueDecoder = (v) => v;

function decodeDescriptor(raw: unknown, envValue: EnvValueDecoder): McpServerDescriptor | null {
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
    if (envEntries.length > 0) descriptor.env = Object.fromEntries(envEntries.map(([k, v]) => [k, envValue(v)]));
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

function decodeServer(raw: unknown, envValue: EnvValueDecoder): StoredMcpServerConfig | null {
  const o = asRecord(raw);
  const id = asString(o.id, '');
  const name = asString(o.name, '');
  const descriptor = decodeDescriptor(o.descriptor, envValue);
  // A record missing any of these is useless — drop it rather than hand
  // back a half-formed entry the registry can't act on.
  if (!id || !name || !descriptor) return null;
  return { id, name, enabled: asBool(o.enabled, false), descriptor };
}

function decodeWith(envValue: EnvValueDecoder) {
  return (raw: unknown): StoredMcpServerConfig[] => {
    const list = requireRecord(raw, 'mcp-servers.json').servers;
    if (list !== undefined && !Array.isArray(list)) throw new Error('"servers" is not an array');
    return Array.isArray(list)
      ? list.map((s) => decodeServer(s, envValue)).filter((s): s is StoredMcpServerConfig => s !== null)
      : [];
  };
}

/** For a write: env values exactly as on disk (encrypted, or legacy plaintext). */
const decodeStored = decodeWith(asStored);

function mapEnv(server: StoredMcpServerConfig, fn: (v: string) => string): StoredMcpServerConfig {
  const d = server.descriptor;
  if (d.kind !== 'stdio' || !d.env) return server;
  return { ...server, descriptor: { ...d, env: Object.fromEntries(Object.entries(d.env).map(([k, v]) => [k, fn(v)])) } };
}

/** On-disk form: every env value encrypted, already-encrypted ones untouched. */
const toStored = (s: StoredMcpServerConfig) => mapEnv(s, (v) => (isEncrypted(v) ? v : encryptSecret(v)));
/** Caller-facing form of a stored record. */
const toUsable = (s: StoredMcpServerConfig) => mapEnv(s, decryptSecret);

function hasPlaintextEnv(servers: StoredMcpServerConfig[]): boolean {
  return servers.some((s) => s.descriptor.kind === 'stdio' && Object.values(s.descriptor.env ?? {}).some((v) => v && !isEncrypted(v)));
}

/** `file` is injectable for tests (mirrors `menu-config-store.ts`'s
 *  `saveMenuConfig(config, file = menuConfigPath())` convention) — real
 *  callers never pass it. LENIENT: never build a write from this. */
export async function getStoredServers(file: string = mcpServersConfigPath()): Promise<StoredMcpServerConfig[]> {
  // Read as stored first: only a file that still holds plaintext env values
  // schedules the upgrade — so a profile with nothing to encrypt never touches
  // the keychain (safeStorage) at startup. Doing so unconditionally hung the
  // packaged app's launch on a CI runner, where a keychain prompt has no one
  // to answer it, and would prompt users who have never stored a secret.
  const stored = await loadConfigFile(() => file, decodeStored, []);
  if (hasPlaintextEnv(stored)) scheduleEnvUpgrade(file);
  return stored.map(toUsable);
}

/**
 * Lazy upgrade (#2562): once per file per process, if the stored env still
 * holds plaintext values and the keychain is usable, rewrite the file so they
 * are encrypted — and the file tightened to 0600 — without waiting for the
 * user to edit a server. Never fails the read; a failure is logged and the
 * next mutation encrypts them anyway.
 */
const upgradeAttempted = new Set<string>();
function scheduleEnvUpgrade(file: string): void {
  if (upgradeAttempted.has(file) || !secretEncryptionAvailable()) return;
  upgradeAttempted.add(file);
  void mutateServers(file, (servers) => ({ next: hasPlaintextEnv(servers) ? servers : null, result: undefined }))
    .catch((e: unknown) => logger('mcp-client').warn('could not encrypt MCP server env values in', file, e));
}

/** Test-only: forget which files have had their lazy upgrade attempted. */
export function _resetEnvUpgradeForTests(): void {
  upgradeAttempted.clear();
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
    // Values as stored — see the header for why a write never decrypts.
    const servers = await loadConfigFileStrict(file, decodeStored, []);
    const { next, result } = fn(servers);
    if (next) await writeJsonFileAtomic(file, { servers: next.map(toStored) }, { trailingNewline: true, mode: SECRET_FILE_MODE });
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
    return { next: updated ? next : null, result: updated ? toUsable(updated) : null };
  });
}

export function addStoredServer(
  name: string,
  descriptor: McpServerDescriptor,
  file: string = mcpServersConfigPath(),
): Promise<StoredMcpServerConfig> {
  const server: StoredMcpServerConfig = { id: crypto.randomUUID(), name, enabled: false, descriptor };
  return mutateServers(file, (servers) => ({ next: [...servers, server], result: toUsable(server) }));
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
