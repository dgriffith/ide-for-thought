/**
 * MCP client transport (#2029, epic #2032) — public types.
 *
 * This is the reverse direction from `src/cli/mcp.ts` (Minerva as an MCP
 * *server*, epic #1145): here Minerva is the client, consuming a
 * third-party server's tools. Transport/protocol only — no auth, no
 * persistent server config, no wiring into the conversation tool array.
 * Those are separate, later issues; this module's public surface
 * (`connectMcpServer` in `client.ts`) exists to be consumed by them.
 */

/** Which protocol era a connected server speaks — see `era.ts` for how this
 *  is decided. Cached for the lifetime of a transport instance; never
 *  re-probed mid-connection. */
export type McpEra = 'legacy' | 'modern';

/**
 * `McpServerDescriptor` (how to reach a server — `headers` on the http
 * variant is a static pass-through bag the OAuth flow, #2030, injects
 * `Authorization: Bearer …` into; this layer performs no auth logic itself)
 * and `McpToolDescriptor` are defined in `src/shared/mcp-servers.ts`, not
 * here — #2031 sends both across the IPC boundary, and `src/shared/` is
 * where cross-process wire types live. Re-exported so every existing
 * `from './types'` / `from '../types'` import in this package keeps working.
 */
import type { McpServerDescriptor, McpToolDescriptor } from '../../shared/mcp-servers';
export type { McpServerDescriptor, McpToolDescriptor };

/** A single MCP content block (text/image/resource/…). Passed through
 *  verbatim — narrowing into a discriminated union is a later issue's
 *  job once a consumer actually needs to render specific block types. */
export interface McpContentBlock {
  type: string;
  [key: string]: unknown;
}

/**
 * Result of a `tools/call`. `isError: true` means the TOOL reported a
 * problem (a normal, non-exceptional outcome the caller renders inline) —
 * it mirrors `NotebaseTool`'s `ToolResult` shape exactly
 * (`src/main/llm/tools/types.ts`) so a later issue mapping one onto the
 * other needs no shape translation for this field. Protocol-level failures
 * (unknown tool, transport drop, …) throw instead — see `errors.ts`.
 */
export interface McpToolCallResult {
  content: McpContentBlock[];
  isError: boolean;
}

/** Filter for `subscriptions/listen` (modern era only) — which change
 *  notifications the caller wants delivered. */
export interface McpSubscriptionFilter {
  toolsListChanged?: boolean;
  promptsListChanged?: boolean;
  resourcesListChanged?: boolean;
  resourceSubscriptions?: string[];
}

export interface McpNotification {
  method: string;
  params: Record<string, unknown>;
}

export interface McpSubscription {
  subscriptionId: string | number;
  close(): void;
}

/**
 * Common surface both transports implement, so a caller never needs to know
 * which one it's talking to. `listenForChanges` is optional — only the
 * modern HTTP transport supports it (legacy's equivalent, the GET SSE
 * stream, opens automatically in `connect()` and has no caller-facing
 * subscribe call); callers that need change notifications on both eras are
 * a later issue's concern.
 */
export interface McpTransport {
  /** Valid only after `connect()` resolves. */
  readonly era: McpEra;
  connect(signal?: AbortSignal): Promise<void>;
  listTools(signal?: AbortSignal): Promise<McpToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<McpToolCallResult>;
  close(): Promise<void>;
  listenForChanges?(
    filter: McpSubscriptionFilter,
    onNotification: (n: McpNotification) => void,
    signal?: AbortSignal,
  ): Promise<McpSubscription>;
}

/**
 * Resolves a modern-era `input_required` result (the MRTR pattern — see
 * `http/modern-http-transport.ts`). Keys match `result.inputRequests`'
 * keys; values become `inputResponses` on the re-issued request. The
 * default handler (used when a caller supplies none) answers
 * `roots/list`/`elicitation/create` honestly and throws for
 * `sampling/createMessage` — see `errors.ts`'s
 * `McpInputRequiredUnhandledError`.
 */
export type InputRequiredHandler = (
  requests: Record<string, { method: string; params: Record<string, unknown> }>,
) => Promise<Record<string, Record<string, unknown>>>;

/** Self-identification sent in every handshake/`_meta` block. Static,
 *  matching `src/cli/mcp.ts`'s own hardcoded `SERVER_INFO` rather than
 *  reading `package.json` at runtime — this is a protocol identifier, not
 *  a build artifact. */
export const CLIENT_INFO = { name: 'minerva', version: '1.0.0' } as const;
