/**
 * The provider seam (#1148, epic #1145 — Substrate).
 *
 * Everything in this file is provider-neutral. The conversation layer — the
 * agentic loop in `../index.ts`, tool dispatch, the approval gate, and the
 * skills that compile into tools — talks to the `LLMProvider` interface and
 * these neutral types, never to `@anthropic-ai/sdk` directly. All Claude-
 * specific translation lives behind a single implementation (`./anthropic.ts`).
 *
 * This is the *seam*, not multi-provider support: today there is exactly one
 * implementation. Its job is to make sure adding a second provider later is
 * "write one more implementation of this interface" rather than "rewrite the
 * gate." See `docs/vision/substrate-mcp.md` → *Internal agnosticism*.
 */
import type { Citation, TurnUsage } from '../../../shared/types';
import type { Effort } from '../../../shared/tools/effort';
import type { ConnectionCheckResult } from '../../../shared/tools/types';

/**
 * A provider-neutral tool declaration — the JSON-Schema shape the model sees.
 * The field names mirror the common wire form (`input_schema`); each provider's
 * implementation adapts them to its own API as needed. Structurally identical to
 * what the tool files under `../tools/` already emit, so introducing this type
 * cost them no changes.
 */
export interface ToolSpec {
  name: string;
  description?: string;
  input_schema: {
    type: 'object';
    properties?: Record<string, unknown> | undefined;
    required?: string[] | undefined;
    [key: string]: unknown;
  };
}

/** Server-side web search/fetch settings, if the provider supports them. */
export interface WebToolSettings {
  enabled: boolean;
  allowedDomains?: string[] | undefined;
  blockedDomains?: string[] | undefined;
}

/**
 * An opaque native conversation-history entry. The agentic loop treats these as
 * black boxes — only the provider constructs them (`ingestHistory`,
 * `toolResultMessage`, `TurnResult.assistantMessage`) and only the provider
 * reads them (`runTurn`). Branded so a raw object can't be smuggled in where a
 * provider-owned message is expected.
 */
export type ProviderMessage = { readonly __brand: 'ProviderMessage' };

/** A neutral chat turn used to seed a conversation before the loop runs. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** A client-side tool call the loop must execute against the tool registry. */
export interface ProviderToolCall {
  id: string;
  name: string;
  input: unknown;
}

/** The outcome of executing one tool call, fed back to the model next turn. */
export interface ProviderToolResult {
  toolUseId: string;
  content: string;
  isError: boolean;
}

export interface TurnHooks {
  /** Fired as assistant text streams in (drives the live typing in the UI). */
  onTextDelta?: ((delta: string) => void) | undefined;
  /**
   * Fired once per tool-use block the model emits (client- or server-side),
   * before execution — drives the live "🔍 Searching…" indicators. The provider
   * de-duplicates: exactly one call per block, whether it surfaced mid-stream or
   * only in the final message.
   */
  onToolCallStart?: ((name: string, input: unknown) => void) | undefined;
}

export interface TurnRequest {
  model: string;
  system: string;
  /** Native history — seeded by `ingestHistory`, grown via prior turns. */
  history: ProviderMessage[];
  tools: ToolSpec[];
  web: WebToolSettings;
  /** Already resolved + clamped to the model; the provider just applies it. */
  effort?: Effort | undefined;
  maxTokens: number;
  /** Code-execution sandbox id to echo back when the history references one. */
  containerId?: string | null | undefined;
  signal?: AbortSignal | undefined;
}

/** Why the model stopped: neutral over provider-specific stop-reason strings. */
export type StopReason = 'end' | 'tool_use' | 'pause';

export interface TurnResult {
  /** Append to `history` before the next turn. */
  assistantMessage: ProviderMessage;
  /** The turn's assistant text (final blocks joined), for the transcript. */
  text: string;
  /** Client-side tool calls for the loop to execute; empty when none. */
  toolCalls: ProviderToolCall[];
  citations: Citation[];
  /** This single turn's token usage; the loop sums across turns. */
  usage: TurnUsage;
  stopReason: StopReason;
  containerId?: string | undefined;
  containerExpiresAt?: string | undefined;
}

export interface CompletionRequest {
  model: string;
  system?: string | undefined;
  messages: ChatMessage[];
  effort?: Effort | undefined;
  maxTokens: number;
  signal?: AbortSignal | undefined;
}

export interface CompletionResult {
  text: string;
  usage: TurnUsage;
}

/**
 * The provider boundary. Adding a second model provider means implementing this
 * interface; the gate, the skills, the tool dispatch, and the agentic loop stay
 * exactly as they are.
 */
export interface LLMProvider {
  /** Stable id for provenance/logging, e.g. `"anthropic"`. */
  readonly id: string;
  /** Convert neutral seed history into native message objects. */
  ingestHistory(messages: ChatMessage[]): ProviderMessage[];
  /** Wrap executed tool results as a native user-role message. */
  toolResultMessage(results: ProviderToolResult[]): ProviderMessage;
  /** Run ONE streaming model call, returning a neutral structured result. */
  runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult>;
  /** Single-shot completion; streams via `onDelta` when provided. */
  complete(
    req: CompletionRequest,
    onDelta?: (delta: string) => void,
  ): Promise<CompletionResult>;
  /** Validate the configured key with a cheap, token-free request — powers the
   *  settings "Check connection" button. Never throws: failures come back as
   *  `{ ok: false, error }`. */
  checkConnection(): Promise<ConnectionCheckResult>;
}
