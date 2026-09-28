/**
 * "Don't ask again for this tool" — the remembered half of the MCP
 * write-confirmation gate (#2439). Stored per MACHINE in
 * `userData/mcp-tool-permissions.json`, never in a thoughtbase: a synced or
 * shared thoughtbase must not be able to pre-authorize a write tool on the
 * machine that opens it. Same reasoning as `compute/consent.ts` (#1412).
 *
 * ── What a grant is keyed on ───────────────────────────────────────────────
 * `(serverIdentity(descriptor), toolName)`. The server's identity is a hash of
 * its CONNECTION config — for stdio the command, args, env and cwd; for http
 * the URL — not its display name or config id:
 *
 *   - Change the command, an argument, an env var or the URL and a different
 *     program (or endpoint) is now answering to that name. The user trusted the
 *     old one; the grant must not carry over, and with this key it can't.
 *   - Renaming a server is cosmetic and keeps its grants.
 *   - Removing a server and re-adding it with byte-identical config gets its
 *     grants back. That is the same binary, so it's the same trust decision;
 *     "Reset allowed MCP tools" in Settings is the way to revoke.
 *
 * `headers` on an http descriptor is deliberately excluded: the OAuth flow
 * injects a bearer token there at connect time, and a token refresh is not a
 * new server.
 *
 * `env` is hashed, not stored — only the digest lands on disk, so a secret in
 * a server's env never appears in this file.
 *
 * ── Read/write discipline (CLAUDE.md *Config files*) ───────────────────────
 * The check reads LENIENTLY: a corrupt file is reported and reads as "nothing
 * remembered", which fails safe (the card is shown again, the call never runs
 * on a grant that can't be read). Grant and reset read STRICTLY and write
 * atomically, so a corrupt file makes the grant throw rather than erase every
 * other grant. The store is synchronous from read to write, so two grants can't
 * interleave and no file lock is needed (see `config/file-lock.ts`'s header).
 *
 * ── Where the file is ───────────────────────────────────────────────────────
 * This package is electron-free (see `config-store.ts`), so the path is handed
 * in by `ipc/register-mcp-servers.ts` at startup rather than read from
 * `app.getPath` here. Until it is configured — the CLI, which never registers
 * IPC — nothing reads as remembered and a grant throws: fail closed.
 */
import { createHash } from 'node:crypto';
import {
  asRecord,
  asString,
  loadConfigFileStrictSync,
  loadConfigFileSync,
  requireRecord,
} from '../config/config-store';
import { writeJsonFileAtomicSync } from '../config/json-file';
import type { McpServerDescriptor } from '../../shared/mcp-servers';

interface AllowedTool {
  /** `serverIdentity(descriptor)` — see the header. */
  server: string;
  tool: string;
  /** Display only: the server's name when the grant was made. */
  serverName: string;
  grantedAt: string;
}

interface PermissionsFile {
  allowed: AllowedTool[];
}

let configuredPath: string | null = null;

/** Called once at startup with `userData/mcp-tool-permissions.json`. */
export function configureMcpToolPermissionsPath(absPath: string): void {
  configuredPath = absPath;
}

/** Test-only: point the store at a temp file, or back to unconfigured. */
export function _setMcpToolPermissionsPathForTests(p: string | null): void {
  configuredPath = p;
}

export function mcpToolPermissionsPath(): string {
  if (!configuredPath) throw new Error('The MCP tool-permissions store is not configured in this process.');
  return configuredPath;
}

/**
 * Stable identity for a server's connection config. Built from an explicit
 * field list rather than `JSON.stringify(descriptor)`, so key order, an absent
 * vs. empty `args`, or a runtime-only field (`headers`) can't change it.
 */
export function serverIdentity(descriptor: McpServerDescriptor): string {
  const canonical = descriptor.kind === 'stdio'
    ? [
        'stdio',
        descriptor.command,
        descriptor.args ?? [],
        Object.entries(descriptor.env ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
        descriptor.cwd ?? '',
      ]
    : ['http', descriptor.url];
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex');
}

function decode(raw: unknown): PermissionsFile {
  const list = requireRecord(raw, 'mcp-tool-permissions.json').allowed;
  if (list !== undefined && !Array.isArray(list)) throw new Error('"allowed" is not an array');
  const allowed: AllowedTool[] = [];
  for (const item of Array.isArray(list) ? list : []) {
    const o = asRecord(item);
    const server = asString(o.server, '');
    const tool = asString(o.tool, '');
    // A record missing its key can't match anything — drop it.
    if (!server || !tool) continue;
    allowed.push({ server, tool, serverName: asString(o.serverName, ''), grantedAt: asString(o.grantedAt, '') });
  }
  return { allowed };
}

const EMPTY: PermissionsFile = { allowed: [] };

function readLenient(): PermissionsFile {
  return loadConfigFileSync(mcpToolPermissionsPath, decode, EMPTY);
}

function readForWrite(): PermissionsFile {
  // A fresh empty value, never the shared EMPTY: `allowTool` pushes into it.
  return loadConfigFileStrictSync(mcpToolPermissionsPath(), decode, { allowed: [] });
}

function write(data: PermissionsFile): void {
  writeJsonFileAtomicSync(mcpToolPermissionsPath(), data, { trailingNewline: true });
}

/** Has the user chosen "Don't ask again" for this tool on this exact server config? */
export function isToolAllowed(descriptor: McpServerDescriptor, toolName: string): boolean {
  const server = serverIdentity(descriptor);
  return readLenient().allowed.some((a) => a.server === server && a.tool === toolName);
}

/** Record "Don't ask again" for one tool on one server identity. Idempotent. */
export function allowTool(descriptor: McpServerDescriptor, serverName: string, toolName: string): void {
  const server = serverIdentity(descriptor);
  const data = readForWrite();
  if (data.allowed.some((a) => a.server === server && a.tool === toolName)) return;
  data.allowed.push({ server, tool: toolName, serverName, grantedAt: new Date().toISOString() });
  write(data);
}

/** Settings → MCP "Reset allowed MCP tools". Returns how many grants it cleared. */
export function resetAllowedTools(): number {
  const data = readForWrite();
  const cleared = data.allowed.length;
  if (cleared > 0) write({ allowed: [] });
  return cleared;
}
