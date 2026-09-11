/**
 * MCP server management (#2031) — wire types shared by main, preload, and
 * renderer. `McpServerDescriptor`/`McpToolDescriptor` are the canonical
 * definitions (the protocol library at `src/main/mcp-client/types.ts`
 * re-exports them rather than defining its own — see that file) since they
 * cross the IPC boundary and `src/shared/` is where cross-process wire types
 * live, not `src/main/**`.
 */

/** How to reach a server. `headers` on the http variant is a static
 *  pass-through bag the OAuth flow (#2030) injects `Authorization: Bearer …`
 *  into before connecting — never user-authored. */
export type McpServerDescriptor =
  | { kind: 'stdio'; command: string; args?: string[]; env?: Record<string, string>; cwd?: string }
  | { kind: 'http'; url: string; headers?: Record<string, string> };

/** MCP's own `Tool.annotations` — hints about a tool's behavior, all
 *  optional. Per the spec's own security warning, clients MUST consider
 *  these untrusted unless they come from a trusted server: a
 *  malicious/misconfigured server could mislabel a destructive tool as
 *  read-only. #2028 trusts `readOnlyHint` as a best-effort heuristic anyway
 *  (not a security boundary) rather than confirming every call — see that
 *  issue's plan for the reasoning. */
export interface McpToolAnnotations {
  title?: string;
  /** Default false when absent — an unannotated tool is NOT read-only. */
  readOnlyHint?: boolean;
  /** Meaningful only when `readOnlyHint` is false; default true. */
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface McpToolDescriptor {
  name: string;
  description?: string;
  inputSchema: { type: 'object'; properties?: Record<string, unknown>; required?: string[] };
  annotations?: McpToolAnnotations;
}

/** `'connecting'` is a transient state a `mcpServers:list` read can observe
 *  mid-flight; every mutation channel resolves only once the attempt has
 *  settled into one of the other four. */
export type McpServerConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'needs-auth' | 'error';

/** On-disk shape, `~/.minerva/mcp-servers.json` — see `docs/config-roots.md`. */
export interface StoredMcpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  descriptor: McpServerDescriptor;
}

/** What the renderer gets back from the list read and from every mutation —
 *  persisted config merged with in-memory (never persisted) connection state. */
export interface McpServerStatus extends StoredMcpServerConfig {
  status: McpServerConnectionStatus;
  error?: string;
  /** Cached from the most recent successful connect; empty when not connected. */
  tools: McpToolDescriptor[];
}
