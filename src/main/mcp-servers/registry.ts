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
  type McpToolCallResult,
} from '../mcp-client';
import { logger } from '../../shared/logger';
import type {
  McpCallDecision,
  McpServerStatus,
  McpServerConnectionStatus,
  McpToolDescriptor,
  StoredMcpServerConfig,
} from '../../shared/mcp-servers';
import { allowTool, isToolAllowed, serverIdentity } from './tool-permissions';
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
  // The settings form sends the connection details with every save, so
  // "a descriptor arrived" doesn't mean "it changed" — compare. A save that
  // only renames (or re-saves the same details) leaves the connection alone;
  // it used to drop it, and the row sat disconnected until you clicked Connect.
  const before = await requireStoredServer(id);
  const changed = patch.descriptor !== undefined && serverIdentity(patch.descriptor) !== serverIdentity(before.descriptor);
  // A changed descriptor makes the old client stale — don't leave it talking
  // to a server the config no longer describes.
  if (changed) await disconnectOne(id);
  await updateStoredServer(id, patch);
  // …and an enabled server reconnects to the new details on its own, the
  // same best-effort, non-interactive connect as switching it on: a remote
  // server that needs signing in shows that, rather than popping a browser.
  if (changed && before.enabled) await connectOne(await requireStoredServer(id), { interactive: false });
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

/**
 * Asks the user whether one `mcp_call` may run (#2439). Supplied by the
 * conversation surface (`ipc/conversation-stream.ts`); `null` means there is
 * no UI to ask in (the CLI, the eval harness, a background run), and a call
 * that needs confirmation is then REFUSED, never allowed.
 */
export type McpCallConfirmer = (req: McpCallConfirmPrompt) => Promise<McpCallDecision>;

/** What the confirmation card shows. `argsJson` is exactly what will be sent. */
export interface McpCallConfirmPrompt {
  serverName: string;
  toolName: string;
  title?: string;
  description?: string;
  argsJson: string;
  destructiveHint?: boolean;
}

/** What `callServerTool` did. A declined call never touched the transport. */
export type McpCallOutcome =
  | { kind: 'called'; result: McpToolCallResult }
  | { kind: 'declined'; reason: 'denied' | 'cancelled' | 'no-ui' };

/** True only for a tool the server itself marked `readOnlyHint: true`. */
export function isReadOnlyTool(tool: McpToolDescriptor): boolean {
  return tool.annotations?.readOnlyHint === true;
}

function confirmPrompt(serverName: string, tool: McpToolDescriptor, args: Record<string, unknown>): McpCallConfirmPrompt {
  const title = tool.annotations?.title;
  const destructiveHint = tool.annotations?.destructiveHint;
  return {
    serverName,
    toolName: tool.name,
    ...(title !== undefined ? { title } : {}),
    ...(tool.description !== undefined ? { description: tool.description } : {}),
    // The same object `callTool` receives below, serialized once here so the
    // card shows the bytes that go on the wire rather than a re-rendering.
    argsJson: JSON.stringify(args, null, 2),
    ...(destructiveHint !== undefined ? { destructiveHint } : {}),
  };
}

/**
 * Invoke a tool on a connected server, addressed by the human-facing `name`
 * (what the settings UI and the `mcp_call` dispatcher catalog both show —
 * #2028). `live` is keyed by config id, so this resolves name -> id first.
 *
 * ── The write-confirmation gate (#2439) ─────────────────────────────────────
 * The gate lives here, not in the `mcp_call` tool, so no path reaches a
 * server's `tools/call` around it: `confirm` is a required parameter, and a
 * caller with no UI must pass `null` and accept the refusal.
 *
 *   1. `annotations.readOnlyHint === true` in the catalog the server advertised
 *      at connect time: runs without asking.
 *   2. Anything else (no annotations, `readOnlyHint: false`, any
 *      `destructiveHint`) needs the user:
 *      - no UI (`confirm === null`): refused, even if the user once chose
 *        "Don't ask again". A remembered grant means "don't ask me", not "run
 *        it where I can't see it";
 *      - remembered for this exact server identity + tool
 *        (`tool-permissions.ts`): runs;
 *      - otherwise the conversation shows a card and waits.
 *
 * Accepted residual risk: `readOnlyHint` is the server's own claim. A server
 * that mislabels a write tool as read-only gets it run unconfirmed. The MCP
 * spec says clients must treat annotations from an untrusted server as
 * untrusted; this gate covers honest servers, and the user chose which servers
 * to connect.
 */
export async function callServerTool(
  serverName: string,
  toolName: string,
  args: Record<string, unknown>,
  confirm: McpCallConfirmer | null,
): Promise<McpCallOutcome> {
  const configs = await getStoredServers();
  const matches = configs.filter((c) => c.name === serverName);
  if (matches.length > 1) {
    throw new Error(`Multiple MCP servers are named "${serverName}"; rename one to disambiguate.`);
  }
  const match = matches[0];
  if (!match) {
    const known = configs.map((c) => c.name).join(', ') || '(none configured)';
    throw new Error(`No MCP server named "${serverName}". Known servers: ${known}`);
  }
  const entry = live.get(match.id);
  if (!entry || entry.status !== 'connected' || !entry.client) {
    throw new Error(`MCP server "${serverName}" is not connected.`);
  }
  // Only a tool the server advertised at connect time (#2373). `mcp_call`'s
  // server/tool arguments are model-chosen free text, and a prompt injection
  // can name anything; the catalog the model is shown is exactly `entry.tools`,
  // so this narrows the callable surface to what the user could see in
  // Settings rather than whatever the server will answer to.
  const tool = entry.tools.find((t) => t.name === toolName);
  if (!tool) {
    const known = entry.tools.map((t) => t.name).join(', ') || '(none)';
    throw new Error(`MCP server "${serverName}" has no tool named "${toolName}". Its tools: ${known}`);
  }

  if (!isReadOnlyTool(tool)) {
    const where = `${serverName}/${toolName}`;
    const audit = logger('mcp-confirm');
    if (!confirm) {
      audit.info(`refused ${where}: not read-only, and no conversation UI to confirm it`);
      return { kind: 'declined', reason: 'no-ui' };
    }
    let remember = false;
    if (isToolAllowed(match.descriptor, toolName)) {
      audit.info(`allowed ${where} (remembered: don't ask again)`);
    } else {
      let decision: McpCallDecision;
      try {
        decision = await confirm(confirmPrompt(serverName, tool, args));
      } catch (err) {
        // A confirmer that fails is not a yes.
        audit.warn(`denied ${where}: the confirmation failed`, err);
        return { kind: 'declined', reason: 'denied' };
      }
      if (!decision.allow) {
        audit.info(`denied ${where} (${decision.reason})`);
        return { kind: 'declined', reason: decision.reason };
      }
      remember = decision.remember;
      audit.info(`allowed ${where} by the user${remember ? ", don't ask again" : ''}`);
    }
    // The card may have been up for minutes. If the server was disconnected or
    // reconfigured meanwhile, the connection the user approved is gone and a
    // new one may be a different program: refuse rather than send.
    if (live.get(match.id) !== entry || entry.status !== 'connected' || !entry.client) {
      audit.warn(`not sending ${where}: the server changed while awaiting confirmation`);
      throw new Error(`MCP server "${serverName}" changed while the call was awaiting confirmation; nothing was sent.`);
    }
    if (remember) {
      try {
        allowTool(match.descriptor, serverName, toolName);
      } catch (err) {
        // The user said yes to THIS call. Failing to remember it only means
        // they'll be asked again next time; it is not a reason to refuse.
        audit.warn(`could not remember "don't ask again" for ${where}:`, err);
      }
    }
  }
  return { kind: 'called', result: await entry.client.callTool(toolName, args) };
}
