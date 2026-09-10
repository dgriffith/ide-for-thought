/**
 * Live MCP server connections (#2031) — the layer between the persisted
 * config (`config-store.ts`) and the protocol library (`../mcp-client`).
 * Connection state (`live`, below) is in-memory only, never persisted —
 * mirrors the browser-clipper's "running" being derived rather than stored.
 *
 * Remote descriptors always connect via `connectMcpServerWithOAuth`, never
 * plain `connectMcpServer` — that function already tries an unauthenticated
 * connect first and only runs the OAuth dance if the server actually
 * challenges for it, so this module never has to decide up front whether a
 * given remote server needs auth.
 *
 * No app-quit hook here: `shutdownAllMcpClients()` (`../mcp-client`, already
 * wired into `main.ts`'s `before-quit`) tears down every live transport
 * generically, including the ones this module creates — confirmed
 * `connectMcpServerWithOAuth`'s inner `connectMcpServer` call registers in
 * the same transport set.
 */
import {
  connectMcpServer,
  connectMcpServerWithOAuth,
  McpInteractiveAuthRequiredError,
  type McpClient,
} from '../mcp-client';
import { logger } from '../../shared/logger';
import type { McpServerStatus, McpServerConnectionStatus, McpToolDescriptor, StoredMcpServerConfig } from '../../shared/mcp-servers';
import {
  addStoredServer,
  getStoredServers,
  removeStoredServer,
  setStoredServerEnabled,
  updateStoredServer,
  type StoredMcpServerPatch,
} from './config-store';

interface LiveEntry {
  client: McpClient | null;
  status: McpServerConnectionStatus;
  error?: string;
  tools: McpToolDescriptor[];
}

const live = new Map<string, LiveEntry>();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function connectOne(cfg: StoredMcpServerConfig, opts: { interactive: boolean }): Promise<void> {
  live.set(cfg.id, { client: null, status: 'connecting', tools: [] });
  try {
    const client = cfg.descriptor.kind === 'stdio'
      ? await connectMcpServer(cfg.descriptor)
      : await connectMcpServerWithOAuth(cfg.descriptor, { interactive: opts.interactive });
    const tools = await client.listTools();
    live.set(cfg.id, { client, status: 'connected', tools });
  } catch (err) {
    if (err instanceof McpInteractiveAuthRequiredError) {
      live.set(cfg.id, { client: null, status: 'needs-auth', tools: [] });
    } else {
      live.set(cfg.id, { client: null, status: 'error', error: errorMessage(err), tools: [] });
    }
  }
}

async function disconnectOne(id: string): Promise<void> {
  const entry = live.get(id);
  live.delete(id);
  if (entry?.client) {
    await entry.client.close().catch((err: unknown) => {
      logger('mcp-servers').debug(`failed to close server ${id} (best-effort cleanup):`, err);
    });
  }
}

export async function listServerStatuses(): Promise<McpServerStatus[]> {
  const configs = await getStoredServers();
  return configs.map((cfg) => {
    const entry = live.get(cfg.id);
    return {
      ...cfg,
      status: entry?.status ?? 'disconnected',
      ...(entry?.error !== undefined ? { error: entry.error } : {}),
      tools: entry?.tools ?? [],
    };
  });
}

async function requireStoredServer(id: string): Promise<StoredMcpServerConfig> {
  const cfg = (await getStoredServers()).find((s) => s.id === id);
  if (!cfg) throw new Error(`no such MCP server: ${id}`);
  return cfg;
}

export async function addServer(name: string, descriptor: StoredMcpServerConfig['descriptor']): Promise<McpServerStatus[]> {
  await addStoredServer(name, descriptor);
  return listServerStatuses();
}

export async function updateServer(id: string, patch: StoredMcpServerPatch): Promise<McpServerStatus[]> {
  // The old client is stale the moment the descriptor changes — disconnect
  // rather than leave it talking to a server the config no longer describes.
  // A name-only edit needs no reconnect.
  if (patch.descriptor) await disconnectOne(id);
  await updateStoredServer(id, patch);
  return listServerStatuses();
}

export async function removeServer(id: string): Promise<McpServerStatus[]> {
  await disconnectOne(id);
  await removeStoredServer(id);
  return listServerStatuses();
}

export async function setServerEnabled(id: string, enabled: boolean): Promise<McpServerStatus[]> {
  await setStoredServerEnabled(id, enabled);
  if (enabled) {
    // Best-effort, non-interactive: a remote server with no valid stored
    // token lands on 'needs-auth' rather than popping a browser — the user
    // completes that explicitly via connectServer().
    await connectOne(await requireStoredServer(id), { interactive: false });
  } else {
    await disconnectOne(id);
  }
  return listServerStatuses();
}

/** The only path allowed to pop a browser tab — call only in direct response
 *  to the user clicking Connect. */
export async function connectServer(id: string): Promise<McpServerStatus[]> {
  await connectOne(await requireStoredServer(id), { interactive: true });
  return listServerStatuses();
}

/** Startup hook (`main.ts`): best-effort, non-interactive connect for every
 *  enabled server. Never throws — a single bad server can't block the rest. */
export async function connectAllEnabledServers(): Promise<void> {
  const configs = (await getStoredServers()).filter((s) => s.enabled);
  await Promise.allSettled(configs.map((cfg) => connectOne(cfg, { interactive: false })));
}
