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
  /**
   * Set for a server a plugin ships (#2646). It isn't in the file: it comes
   * and goes with the plugin, can't be edited or removed here, and is on only
   * while the user's approval matches `identity` (declaration + plugin
   * version), which also keys "don't ask again" for its tools.
   */
  plugin?: { id: string; name: string; version: string; title: string; identity: string };
}

/** What the renderer gets back from the list read and from every mutation —
 *  persisted config merged with in-memory (never persisted) connection state. */
export interface McpServerStatus extends StoredMcpServerConfig {
  status: McpServerConnectionStatus;
  error?: string;
  /** Cached from the most recent successful connect; empty when not connected. */
  tools: McpToolDescriptor[];
}

/**
 * The user's answer to an MCP write-confirmation card (#2439), as the main
 * process consumes it. `remember` is only meaningful with `allow: true` —
 * "Don't ask again for this tool" never records a denial.
 *
 * The deny arm carries WHY, because the model is told: `denied` (the user
 * clicked Deny / pressed Escape), `cancelled` (the turn was stopped while the
 * card was up), `no-ui` (no conversation surface could show a card — the
 * window closed, or the caller is the CLI / eval harness / a background run).
 */
export type McpCallDecision =
  | { allow: true; remember: boolean }
  | { allow: false; reason: 'denied' | 'cancelled' | 'no-ui' };
