import { getProvider } from './provider';
import type {
  ChatMessage,
  ProviderMessage,
  ProviderToolResult,
  WebToolSettings,
} from './provider/types';
import {
  buildConversationTools,
  executeNotebaseTool,
  type ToolContext,
  type ToolCallbacks,
} from './tools';
import type { Citation, TurnUsage } from '../../shared/conversation';
import { resolveEffort, type Effort } from '../../shared/tools/effort';
import type { ConversationDraft } from '../../shared/conversation-drafts';
import type { ConversationSourceDraft } from '../../shared/conversation-source-drafts';
import type { ConversationPropertyDraft } from '../../shared/conversation-property-drafts';
import type { ConversationComputeDraft } from '../../shared/conversation-compute-drafts';
import type { ConversationRefactorDraft, ConversationReorgDraft, ConversationDeleteDraft } from '../../shared/conversation-refactor-drafts';
import type { ConversationNoteBodyDraft } from '../../shared/conversation-note-body-drafts';
import type { ConversationSourcePropertyDraft } from '../../shared/conversation-source-property-drafts';
import type { ConversationClaimsDraft } from '../../shared/conversation-claims-drafts';
import type { ConversationToolKey } from '../../shared/conversation-tools';
import { formatToolCall } from './format-tool-call';
import { toLlmFailureError } from './classify-error';
import type { ProviderId } from '../../shared/tools/providers';

/**
 * Run one provider round-trip, classifying any throw into the shared failure
 * taxonomy before it leaves main (#1804).
 *
 * This is the single choke point: IPC strips an SDK error's `status`/`code`, so
 * a failure that isn't classified here can never be told apart from any other
 * downstream — which is how "the model is overloaded" and "your key is revoked"
 * both used to arrive in the renderer as an anonymous `console.error`.
 *
 * Wrap ONLY the provider call, never the surrounding tool execution.
 *
 * `signal` is the caller's abort signal, passed so a cancelled turn is reported
 * as cancelled whatever shape the SDK's error took (#1809).
 */
async function withProviderErrors<T>(
  providerId: ProviderId,
  run: () => Promise<T>,
  signal?: AbortSignal,
): Promise<T> {
  try {
    return await run();
  } catch (err) {
    throw toLlmFailureError(err, providerId, { aborted: signal?.aborted ?? false });
  }
}

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  signal?: AbortSignal | undefined;
  /**
   * Fired when the propose_notes tool produces a ConversationDraft. The
   * conversation IPC handler forwards drafts to the renderer via
   * Channels.CONVERSATION_DRAFT. Optional — calls without it will reject
   * propose_notes invocations with a "no UI surface" error.
   */
  onDraft?: (draft: ConversationDraft) => void;
  /**
   * Counterpart to `onDraft` for the propose_sources tool. Forwarded to
   * the renderer via Channels.CONVERSATION_SOURCE_DRAFT; without it,
   * propose_sources calls fail with a "no UI surface" error.
   */
  onSourceDraft?: (draft: ConversationSourceDraft) => void;
  /**
   * Counterpart to `onDraft` for the set_properties tool. Forwarded to
   * the renderer via Channels.CONVERSATION_PROPERTY_DRAFT; without it,
   * set_properties calls fail with a "no UI surface" error.
   */
  onPropertyDraft?: (draft: ConversationPropertyDraft) => void;
  /**
   * Counterpart to `onPropertyDraft` for the propose_source_properties tool
   * (#103). Forwarded via Channels.CONVERSATION_SOURCE_PROPERTY_DRAFT;
   * without it, the tool fails with a "no UI surface" error.
   */
  onSourcePropertyDraft?: (draft: ConversationSourcePropertyDraft) => void;
  /**
   * Counterpart to `onDraft` for the propose_claims tool (#104). Forwarded via
   * Channels.CONVERSATION_CLAIMS_DRAFT; without it the tool fails with a "no UI
   * surface" error.
   */
  onClaimsDraft?: (draft: ConversationClaimsDraft) => void;
  /**
   * Counterpart to `onDraft` for the propose_compute tool (#245).
   * Forwarded via Channels.CONVERSATION_COMPUTE_DRAFT; without it,
   * propose_compute calls fail with a "no UI surface" error.
   */
  onComputeDraft?: (draft: ConversationComputeDraft) => void;
  /**
   * Counterparts to `onDraft` for the note-refactor tools (#912/#914):
   * propose_note_rename / propose_note_move produce a refactor draft, and
   * propose_reorganization a batch reorg plan. Forwarded to the renderer via
   * CONVERSATION_REFACTOR_DRAFT / CONVERSATION_REORG_DRAFT. Without these the
   * tools report "only available in conversation contexts."
   */
  onRefactorDraft?: (draft: ConversationRefactorDraft) => void;
  onReorgDraft?: (draft: ConversationReorgDraft) => void;
  /**
   * Counterpart for `propose_note_delete`: a batch deletion forwarded to the
   * renderer via CONVERSATION_DELETE_DRAFT. Without it the tool reports "only
   * available in conversation contexts."
   */
  onDeleteDraft?: (draft: ConversationDeleteDraft) => void;
  /**
   * Counterpart for `propose_note_body` (#937): an in-place note rewrite
   * forwarded to the renderer via CONVERSATION_NOTE_BODY_DRAFT. Without it the
   * tool reports "only available in conversation contexts."
   */
  onNoteBodyDraft?: (draft: ConversationNoteBodyDraft) => void;
  /**
   * Wired by the conversation IPC handler when a template declares the
   * `ask_user` tool. The agent's call to `ask_user` resolves with the
   * user's reply. Without this callback the tool reports an error and
   * the agent must continue without the answer.
   */
  askUser?: (input: { question: string; choices?: string[] }) => Promise<string>;
}

/** The conversation callbacks that pass through to tool execution. When a tool
 *  (propose_*, ask_user) needs a renderer surface, its callback must be in this
 *  list or the tool reports "only available in conversation contexts." Add a new
 *  draft callback here when you add one to StreamCallbacks + ToolCallbacks. */
export const TOOL_CALLBACK_KEYS = [
  'onDraft', 'onSourceDraft', 'onPropertyDraft', 'onSourcePropertyDraft',
  'onClaimsDraft', 'onComputeDraft', 'onRefactorDraft', 'onReorgDraft', 'onDeleteDraft', 'onNoteBodyDraft', 'askUser',
] as const satisfies readonly (keyof ToolCallbacks)[];

// Completeness guard (#1003). `satisfies` above rejects a stale/typo'd key; this
// catches the opposite, silent foot-gun: a callback added to `ToolCallbacks`
// (and wired in the conversation IPC handler) but *not* listed here never
// reaches the tool executor, so the tool reports "only available in conversation
// contexts" at runtime with nothing failing at build. If any `ToolCallbacks` key
// is missing from the list, `_UnlistedToolCallbacks` stops being `never` and
// this assignment fails `tsc` (run by `pnpm lint`).
type _UnlistedToolCallbacks = Exclude<keyof ToolCallbacks, (typeof TOOL_CALLBACK_KEYS)[number]>;
// `export`ed so the value binding isn't flagged as an unused local (#1011,
// noUnusedLocals) — its whole job is the compile-time assignment check above.
export const _allToolCallbacksListed: _UnlistedToolCallbacks extends never
  ? true
  : { readonly ERROR: 'key missing from TOOL_CALLBACK_KEYS'; readonly missing: _UnlistedToolCallbacks } = true;

/** Project a conversation's `StreamCallbacks` down to the `ToolCallbacks` the
 *  tool executor expects, carrying every tool-facing callback that's set.
 *  Exported for the regression test that guards against a dropped callback. */
export function toToolCallbacks(callbacks?: StreamCallbacks): ToolCallbacks {
  const out: ToolCallbacks = {};
  if (!callbacks) return out;
  for (const key of TOOL_CALLBACK_KEYS) {
    const fn = callbacks[key];
    if (fn) (out as Record<string, unknown>)[key] = fn;
  }
  return out;
}

export type { ChatMessage } from './provider/types';

export interface CompleteOptions {
  system?: string;
  messages?: ChatMessage[];
  callbacks?: StreamCallbacks;
  /** Override the global default model for this call only. */
  model?: string | undefined;
  /**
   * Per-call reasoning-effort override (#825). Resolved over the global default
   * and clamped to the model; omitted entirely for models without effort
   * support (Haiku). Sent as `output_config.effort`.
   */
  effort?: Effort;
  /**
   * Fired once the single completion finishes, with this call's token usage
   * and the model that produced it (#820). `complete()` keeps returning a
   * plain string — five callers depend on that contract — so usage is
   * surfaced out-of-band here. `/compact` (#824) uses this to count the
   * summarization call's own tokens.
   */
  onUsage?: (usage: TurnUsage, model: string) => void;
  /**
   * Fired when the model stopped because it hit the token cap, i.e. the string
   * this returns is cut off mid-thought (#1811). Out-of-band for the same
   * reason as `onUsage`. Callers decide what that means for them: a skill
   * marks its output as incomplete, `/compact` refuses to install a
   * half-written summary as a conversation's memory, and a tag list doesn't
   * care. Silence here was the bug — a truncated answer looked exactly like a
   * finished one.
   */
  onTruncated?: () => void;
}

export interface CompleteWithToolsOptions {
  system: string;
  messages: ChatMessage[];
  toolContext: ToolContext;
  callbacks?: StreamCallbacks;
  /** Hard cap on tool-use iterations. Defaults to 10. */
  maxIterations?: number;
  /** Override the global default model for this call only. */
  model?: string | undefined;
  /** Per-call reasoning-effort override (#825); resolved over the global
   *  default and clamped to the model. Sent as `output_config.effort`. */
  effort?: Effort | undefined;
  /** Template-scoped tools to enable in addition to the default toolset. */
  extraTools?: ConversationToolKey[] | undefined;
  /**
   * Per-call override of the server-side web tools, replacing the global
   * `settings.web`. Lets a caller run a turn with web off (or a narrowed
   * allow/block list) regardless of the user's global setting — the skill-eval
   * harness uses `{ enabled: false }` to run a skill that declares `web: false`
   * without web tools. Omitted ⇒ the global setting applies.
   */
  web?: WebToolSettings | undefined;
  /**
   * Code-execution sandbox id from a prior agent turn for the same
   * conversation. Must be echoed back whenever the `messages` history
   * carries a `server_tool_use` block (web_search / web_fetch /
   * code_execution), or the API rejects with "container_id is required
   * when there are pending tool uses generated by code execution with
   * tools." See conversation.ts:setContainerId for persistence.
   */
  initialContainerId?: string;
}

export interface CompleteWithToolsResult {
  text: string;
  citations: Citation[];
  /**
   * Token usage summed across every iteration of the agentic loop (#820).
   * A tool-heavy turn loops N times; this is the total of all N, not the
   * last iteration's reading.
   */
  usage: TurnUsage;
  /** Model that produced this turn — needed to price `usage` (#821). */
  usageModel: string;
  /** Final sandbox id at the end of this agent turn — pass to
   *  `setContainerId` so the next turn can echo it back. `undefined`
   *  if no server-side tool ran. */
  containerId?: string;
  /** Expiry timestamp of the sandbox, if one was returned. */
  containerExpiresAt?: string;
}

/**
 * Single-shot completion. Preserves the original API used by the Thinking
 * Tools executor and conversation slash commands — no tool use, streaming
 * controlled by the caller. All provider specifics live behind `provider`.
 */
export async function complete(
  prompt: string,
  callbacksOrOptions?: StreamCallbacks | CompleteOptions,
): Promise<string> {
  let system: string | undefined;
  let messages: ChatMessage[];
  let callbacks: StreamCallbacks | undefined;
  let modelOverride: string | undefined;
  let effortOverride: Effort | undefined;
  let onUsage: ((usage: TurnUsage, model: string) => void) | undefined;
  let onTruncated: (() => void) | undefined;

  if (callbacksOrOptions && 'onChunk' in callbacksOrOptions) {
    callbacks = callbacksOrOptions;
    messages = [{ role: 'user', content: prompt }];
  } else if (callbacksOrOptions) {
    const opts = callbacksOrOptions;
    system = opts.system;
    callbacks = opts.callbacks;
    modelOverride = opts.model;
    effortOverride = opts.effort;
    onUsage = opts.onUsage;
    onTruncated = opts.onTruncated;
    messages = opts.messages ?? [{ role: 'user', content: prompt }];
  } else {
    messages = [{ role: 'user', content: prompt }];
  }

  const { provider, id: providerId, model, effort: defaultEffort } = await getProvider(modelOverride);
  const effort = resolveEffort(model, effortOverride, defaultEffort);

  // `const` (not the outer `let`) so TS keeps the narrowing inside the closure.
  const cb = callbacks;
  const result = await withProviderErrors(providerId, () => provider.complete(
    {
      model,
      system,
      messages,
      effort,
      // One budget for every caller. The old `cb ? 64000 : 16000` split existed
      // because the SDK refuses a non-streaming request whose `max_tokens`
      // implies over ten minutes of work — and every call streams now (#1811),
      // so the paths most likely to truncate no longer get the smaller ceiling.
      maxTokens: 64000,
      signal: cb?.signal,
    },
    cb ? (delta) => cb.onChunk(delta) : undefined,
  ), cb?.signal);
  if (onUsage) onUsage(result.usage, model);
  if (result.stopReason === 'max_tokens' && onTruncated) onTruncated();
  return result.text;
}

/**
 * Tool-enabled completion with streaming. Runs an agentic loop: streams text
 * deltas to the UI on each iteration, handles any tool_use blocks by
 * executing them against the provided ToolContext, and loops until the
 * model stops calling tools.
 *
 * The system prompt + tool schemas are cached (one cache_control breakpoint
 * on the system block) so long conversations don't pay to re-send them.
 */
export async function completeWithTools(
  options: CompleteWithToolsOptions,
): Promise<CompleteWithToolsResult> {
  const { provider, id: providerId, model, web: providerWeb, effort: defaultEffort } = await getProvider(options.model);
  // A per-call `web` override (a `web: false` skill in the eval harness; a
  // per-conversation web setting, #1533) merges over the global web — so a caller
  // that overrides just `enabled` keeps the user's global allow/block domain lists.
  const web = options.web ? { ...providerWeb, ...options.web } : providerWeb;
  const effort = resolveEffort(model, options.effort, defaultEffort);
  const { toolContext, callbacks, maxIterations = 10 } = options;

  // Client-side tools only; server-side web tools are added inside the provider
  // from `web`. History is opaque to this loop — the provider owns its shape.
  const tools = buildConversationTools({ extraTools: options.extraTools });
  const history: ProviderMessage[] = provider.ingestHistory(options.messages);

  const textPieces: string[] = [];
  const citationMap = new Map<string, Citation>();
  // Per-turn usage total, summed across every loop iteration below. Reading
  // only the final iteration's usage would under-report tool-heavy turns by
  // however many tool round-trips it took to get there (#820).
  const usage = emptyUsage();
  // Code-execution sandbox id, threaded across iterations AND across turns of
  // the same conversation (see CompleteWithToolsOptions.initialContainerId). The
  // provider echoes it back on each request and reports the latest id in the
  // turn result; we keep the most-recent non-null so an intermediate
  // non-code-execution turn doesn't drop a still-live sandbox.
  let containerId: string | null = options.initialContainerId ?? null;
  let containerExpiresAt: string | null = null;

  // Guard against a model that gets wedged calling the same write tool with
  // bad input — e.g. propose_notes with an empty payload list. Each such call
  // returns an error tool_result the model is meant to recover from, but a
  // stubborn model can otherwise burn every iteration retrying, which reads to
  // the user as the conversation hanging. After this many consecutive
  // iterations in which *every* tool call errored, give up with a plain
  // message instead of looping to maxIterations.
  const MAX_CONSECUTIVE_ERROR_ITERS = 3;
  let consecutiveAllErrorIters = 0;

  // Surface a tool call as a live "🔍 Searching…" indicator the moment the model
  // emits it — pushed inline into the transcript and streamed to the UI. The
  // provider fires this exactly once per block (client- or server-side).
  const onToolCallStart = (name: string, input: unknown): void => {
    const indicator = `\n\n_${formatToolCall(name, input)}…_\n\n`;
    textPieces.push(indicator);
    if (callbacks) callbacks.onChunk(indicator);
  };

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    if (process.env.MINERVA_LLM_DEBUG) {
      console.log(
        `[llm] iter=${iteration} container=${containerId ?? 'null'} historyLength=${history.length}`,
      );
    }

    // Only the provider round-trip is wrapped — NOT the tool execution below.
    // A tool that throws is a tool bug, and dressing it up as "the provider
    // returned an unexpected error" would be a confident lie (#1804).
    const turn = await withProviderErrors(providerId, () => provider.runTurn(
      {
        model,
        system: options.system,
        history,
        tools,
        web,
        effort,
        maxTokens: 64000,
        containerId,
        signal: callbacks?.signal,
      },
      {
        onTextDelta: callbacks ? (delta) => callbacks.onChunk(delta) : undefined,
        onToolCallStart,
      },
    ), callbacks?.signal);

    sumUsage(usage, turn.usage);
    history.push(turn.assistantMessage);
    // Hold on to the container so the next iteration can reuse it; don't clear
    // it when a later turn reports none.
    if (turn.containerId) {
      containerId = turn.containerId;
      containerExpiresAt = turn.containerExpiresAt ?? null;
    }

    if (turn.text) textPieces.push(turn.text);
    for (const c of turn.citations) {
      if (!citationMap.has(c.url)) citationMap.set(c.url, c);
    }

    // Server-side tool loop (e.g. web_search) can hit its internal iteration
    // cap and pause; re-send the same conversation so it resumes — no extra
    // user message.
    if (turn.stopReason === 'pause') continue;
    // Cut off at the token cap. Say so in the transcript rather than letting a
    // reply that stops mid-sentence read as a complete answer (#1811) — same
    // treatment as the wedged-tool bail-out below.
    if (turn.stopReason === 'max_tokens') {
      const msg = '\n\n_(I hit the length limit for one reply and stopped here. '
        + 'Ask me to continue if you want the rest.)_';
      textPieces.push(msg);
      if (callbacks) callbacks.onChunk(msg);
      break;
    }
    if (turn.stopReason !== 'tool_use') break;
    // Stopped for tool_use but only server-side blocks (which we don't execute)
    // — nothing to run, so stop rather than loop forever.
    if (turn.toolCalls.length === 0) break;

    const toolResults: ProviderToolResult[] = [];
    for (const use of turn.toolCalls) {
      console.log(`[conv] tool call: ${use.name}`, JSON.stringify(use.input).slice(0, 200));
      const { content, isError } = await executeNotebaseTool(
        toolContext,
        use.name,
        use.input,
        toToolCallbacks(callbacks),
      );
      if (isError) {
        console.warn(`[conv] tool ${use.name} returned error:`, content.slice(0, 300));
      }
      toolResults.push({ toolUseId: use.id, content, isError });
    }

    history.push(provider.toolResultMessage(toolResults));

    // Track runs of all-error iterations and bail out of a wedged retry loop.
    const allErrored = toolResults.length > 0 && toolResults.every((r) => r.isError);
    consecutiveAllErrorIters = allErrored ? consecutiveAllErrorIters + 1 : 0;
    if (consecutiveAllErrorIters >= MAX_CONSECUTIVE_ERROR_ITERS) {
      console.warn(`[conv] aborting after ${consecutiveAllErrorIters} consecutive all-error tool iterations`);
      const msg = '\n\n_(I hit repeated tool errors and stopped before finishing. '
        + 'Could you rephrase what you\'d like me to do?)_';
      textPieces.push(msg);
      if (callbacks) callbacks.onChunk(msg);
      break;
    }
  }

  return {
    text: textPieces.join(''),
    citations: [...citationMap.values()],
    usage,
    usageModel: model,
    ...(containerId ? { containerId } : {}),
    ...(containerExpiresAt ? { containerExpiresAt } : {}),
  };
}

function emptyUsage(): TurnUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
}

/**
 * Fold one turn's usage into a running per-turn total, kept distinct by token
 * kind (plain input vs cache read vs cache write) so #821 can price each at its
 * own rate. The provider already reduced the raw API usage to `TurnUsage`; this
 * just sums across the agentic loop's iterations. Mutates and returns `acc`.
 */
function sumUsage(acc: TurnUsage, turn: TurnUsage): TurnUsage {
  acc.inputTokens += turn.inputTokens;
  acc.outputTokens += turn.outputTokens;
  acc.cacheCreationTokens += turn.cacheCreationTokens;
  acc.cacheReadTokens += turn.cacheReadTokens;
  return acc;
}
