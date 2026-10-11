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
import type { Citation, TurnUsage } from '../../../shared/conversation';
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
  /**
   * Tools whose results must stay in the model's context for the whole turn
   * (#2499). A provider that can drop older tool results to keep a long
   * tool-using turn small (Anthropic's server-side context editing) leaves
   * these alone; a provider that can't ignores the field. The loop pins the
   * tools whose result is the model's record of what it already filed or what
   * the user answered.
   */
  pinnedToolResults?: readonly string[] | undefined;
  signal?: AbortSignal | undefined;
}

/**
 * Why the model stopped: neutral over provider-specific stop-reason strings.
 *
 * `max_tokens` (OpenAI calls it `length`) used to fall through to `'end'`, which
 * made a response cut off at the cap indistinguishable from one that finished
 * its sentence — nothing downstream *could* react to a truncation, however much
 * it wanted to (#1811). It is its own reason now, and callers are expected to
 * say so rather than passing half an answer off as a whole one.
 */
export type StopReason = 'end' | 'tool_use' | 'pause' | 'max_tokens';

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
  /** Older tool results the provider dropped from this request's context
   *  (#2499), when it did; absent when nothing was cleared. */
  clearedContext?: { toolUses: number; inputTokens: number } | undefined;
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
  /** Why this one-shot stopped. `'max_tokens'` means the text is cut off. */
  stopReason: StopReason;
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
  /**
   * The exact size, in input tokens, of the request `runTurn(req)` would send
   * — after anything the provider would clear from it (#2499). Optional: the
   * loop asks only when the previous request's usage reads as over its
   * ceiling, because a request that ran a server-side tool loop reports usage
   * summed over every internal step, not the size of its context. A provider
   * without a counting endpoint leaves it out, and the loop goes by usage.
   */
  countContextTokens?(req: TurnRequest): Promise<number>;
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
