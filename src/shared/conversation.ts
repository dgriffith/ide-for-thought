// Conversation core types (#1912 — split out of shared/types.ts). shared/
// already has ~30 domain modules for conversation DRAFT kinds
// (conversation-claims-drafts.ts, conversation-note-body-drafts.ts, …); this
// is the missing module for the conversation CORE itself — the message log,
// its context bundle, and the top-level Conversation record they compose
// into.

export interface ContextBundleNode {
  uri: string;
  type: string;
  label: string;
}

export interface ContextBundle {
  triggerNode?: ContextBundleNode;
  evidenceSet?: ContextBundleNode[];
  neighborhood?: (ContextBundleNode & { relation: string })[];
  pendingFlags?: string[];
  noteContent?: string;
  notePath?: string;
}

export interface Citation {
  url: string;
  title?: string;
  citedText: string;
}

/**
 * Token usage for one completed assistant turn. For tool-using turns this is
 * the **sum** across every iteration of the agentic loop — `completeWithTools`
 * runs up to 10 model calls per turn, each with its own `usage`, and reading
 * only the last one badly under-reports tool-heavy turns. Cache reads/writes
 * are kept distinct from plain input tokens because they price differently
 * (cache read ≈ 0.1× input, cache write ≈ 1.25× input — see #821).
 */
export interface TurnUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
}

export interface ConversationMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: string;
  citations?: Citation[];
  /**
   * Accumulated token usage for the turn that produced this (assistant)
   * message. Persisted so a conversation's running cost survives reload
   * (#820). Absent on user/system messages and on turns that predate usage
   * capture.
   */
  usage?: TurnUsage;
  /**
   * The model that produced this turn. Usage is meaningless for cost without
   * it — pricing is per-model. Recorded alongside `usage` (#820); cost math
   * keyed off this lands in #821.
   */
  usageModel?: string;
  /**
   * Derived turn cost in USD, computed from `usage` under `usageModel`'s
   * pricing at append time and persisted so a conversation's running total
   * survives reload (#821). Absent when the producing model is unpriced — the
   * UI then shows tokens only, never a guessed dollar figure.
   */
  costUSD?: number;
}

export type ConversationStatus = 'active' | 'archived';

/**
 * Result of a `/compact` (#824). On success, `conversation` is the fresh
 * conversation (earlier turns replaced by a summary, recent turns kept
 * verbatim); the pre-compaction original is archived and recoverable. When the
 * thread is too short to be worth compacting, `compacted` is false and `reason`
 * explains why — nothing is changed.
 */
export interface CompactResult {
  compacted: boolean;
  conversation?: Conversation;
  reason?: string;
}

/**
 * Tool-window UI state for the conversations panel. Persisted in
 * `.minerva/conversations/_ui.json` so it survives relaunch but stays
 * project-scoped (different projects can have different layouts).
 */
export interface ConversationsUIState {
  visible: boolean;
  /** Pixel height of the panel when visible. Clamped on render. */
  height: number;
  /** Last-active tab id; null when no tabs are open. */
  activeTabId: string | null;
}

/** The skill (thinking tool) a conversation was launched from, when it was —
 *  e.g. `{ id: 'antithesize', name: 'Antithesize' }`. Kept as the user-facing
 *  name alongside the id so provenance downstream (note-history causes, #1158)
 *  can say "Antithesize" without re-resolving a possibly-uninstalled skill. */
export interface ConversationSkill {
  id: string;
  name: string;
}

export interface ConversationCreateOptions {
  systemPrompt?: string;
  model?: string;
  webEnabled?: boolean;
  skill?: ConversationSkill;
}

export interface Conversation {
  id: string;
  triggerNodeUri?: string;
  contextBundle: ContextBundle;
  messages: ConversationMessage[];
  status: ConversationStatus;
  startedAt: string;
  /** Set when status flips to 'archived'. */
  archivedAt?: string;
  /**
   * Model used for LLM calls in this conversation. `undefined` means the
   * global default from LLMSettings — the conversation then tracks the
   * default if the user changes it later. Once set explicitly, it sticks.
   */
  model?: string;
  /**
   * Per-conversation reasoning-effort override (#825). `undefined` means inherit
   * the global default (`LLMSettings.effort`). Clamped to the active model's
   * supported levels at call time. Mirrors the `model` override pattern.
   */
  effort?: import('./tools/effort').Effort;
  /**
   * Tool-specific system prompt pinned on the conversation. When set, every
   * `send` uses this as the tool/user-supplied system (on top of the
   * default tool-using system prompt built on the main side). Set when the
   * conversation was launched from a `outputMode: 'openConversation'` tool.
   */
  systemPrompt?: string;
  /**
   * Per-conversation web-search override (#1533). `undefined` inherits the
   * global `LLMSettings.web.enabled`; `true`/`false` pin web on/off for this
   * conversation. Set from a launching skill's `web:` declaration (via
   * `ConversationToolPayload.webEnabled`). The global allow/block domain lists
   * still apply. Mirrors the `model` / `effort` override pattern.
   */
  webEnabled?: boolean;
  /**
   * The skill this conversation was launched from (#1158). Set when the
   * conversation came from a `outputMode: 'openConversation'` skill; absent for
   * a freeform chat. Read back when an approved proposal lands a note revision,
   * so the History panel can name the command the user actually ran.
   */
  skill?: ConversationSkill;
  /**
   * Code-execution sandbox id returned by Anthropic when the model used a
   * `code_execution` server-side tool (which is how `web_search_20260209`
   * and `web_fetch_20260209` are wrapped). Every subsequent request whose
   * message history still contains those `server_tool_use` blocks must
   * echo this id back as `container`, or the API responds:
   *   "container_id is required when there are pending tool uses
   *    generated by code execution with tools."
   * Threaded through `completeWithTools` and persisted here so the
   * requirement survives across turns (not just within one agentic loop).
   */
  containerId?: string;
  /** ISO timestamp when the sandbox container expires server-side. */
  containerExpiresAt?: string;
}
