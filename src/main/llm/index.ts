import Anthropic from '@anthropic-ai/sdk';
import { getSettings } from './settings';
import {
  buildConversationTools,
  executeNotebaseTool,
  type ToolContext,
  type ToolCallbacks,
} from './tools';
import type { Citation, TurnUsage } from '../../shared/types';
import { resolveEffort, type Effort } from '../../shared/tools/effort';
import { DEFAULT_WEB_SETTINGS } from '../../shared/tools/types';
import { MISSING_API_KEY_MARKER } from '../../shared/llm-errors';
import type { ConversationDraft } from '../../shared/conversation-drafts';
import type { ConversationSourceDraft } from '../../shared/conversation-source-drafts';
import type { ConversationPropertyDraft } from '../../shared/conversation-property-drafts';
import type { ConversationComputeDraft } from '../../shared/conversation-compute-drafts';
import type { ConversationSourcePropertyDraft } from '../../shared/conversation-source-property-drafts';
import type { ConversationClaimsDraft } from '../../shared/conversation-claims-drafts';
import type { ConversationToolKey } from '../../shared/conversation-tools';
import { formatToolCall } from './format-tool-call';

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  signal?: AbortSignal;
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
   * Wired by the conversation IPC handler when a template declares the
   * `ask_user` tool. The agent's call to `ask_user` resolves with the
   * user's reply. Without this callback the tool reports an error and
   * the agent must continue without the answer.
   */
  askUser?: (input: { question: string; choices?: string[] }) => Promise<string>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompleteOptions {
  system?: string;
  messages?: ChatMessage[];
  callbacks?: StreamCallbacks;
  /** Override the global default model for this call only. */
  model?: string;
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
}

export interface CompleteWithToolsOptions {
  system: string;
  messages: Anthropic.MessageParam[];
  toolContext: ToolContext;
  callbacks?: StreamCallbacks;
  /** Hard cap on tool-use iterations. Defaults to 10. */
  maxIterations?: number;
  /** Override the global default model for this call only. */
  model?: string;
  /** Per-call reasoning-effort override (#825); resolved over the global
   *  default and clamped to the model. Sent as `output_config.effort`. */
  effort?: Effort;
  /** Template-scoped tools to enable in addition to the default toolset. */
  extraTools?: ConversationToolKey[];
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

async function getClient(): Promise<{
  client: Anthropic;
  model: string;
  web: NonNullable<Awaited<ReturnType<typeof getSettings>>['web']>;
  effort: Effort | undefined;
}> {
  const settings = await getSettings();
  if (!settings.apiKey) {
    // Message starts with MISSING_API_KEY_MARKER so the renderer can
    // detect this specific failure across IPC and surface an actionable
    // "Open Settings" dialog instead of the silent log message that was
    // the only feedback before. See `shared/llm-errors.ts`.
    throw new Error(
      `${MISSING_API_KEY_MARKER}. Set it in the LLM settings or ANTHROPIC_API_KEY environment variable.`,
    );
  }
  return {
    client: new Anthropic({ apiKey: settings.apiKey }),
    model: settings.model,
    web: settings.web ?? { ...DEFAULT_WEB_SETTINGS },
    effort: settings.effort,
  };
}

/**
 * Build the `output_config` to attach to a Messages call for a given
 * (model, override) pair, or `undefined` to omit it. Effort is resolved from
 * the per-call override over the global default, then clamped to what the model
 * supports — Haiku gets nothing (sending effort 400s); `xhigh` only survives on
 * Opus. Returned as a partial so callers can spread it onto the params.
 */
function outputConfigFor(
  model: string,
  override: Effort | undefined,
  globalDefault: Effort | undefined,
): { output_config: { effort: Effort } } | undefined {
  const effort = resolveEffort(model, override, globalDefault);
  return effort ? { output_config: { effort } } : undefined;
}

/**
 * Single-shot completion. Preserves the original API used by the Thinking
 * Tools executor and conversation slash commands — no tool use, streaming
 * controlled by the caller.
 */
export async function complete(
  prompt: string,
  callbacksOrOptions?: StreamCallbacks | CompleteOptions,
): Promise<string> {
  let system: string | undefined;
  let messages: Anthropic.MessageParam[];
  let callbacks: StreamCallbacks | undefined;
  let modelOverride: string | undefined;
  let effortOverride: Effort | undefined;
  let onUsage: ((usage: TurnUsage, model: string) => void) | undefined;

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
    messages = (opts.messages ?? [{ role: 'user', content: prompt }]);
  } else {
    messages = [{ role: 'user', content: prompt }];
  }

  const { client, model: defaultModel, effort: defaultEffort } = await getClient();
  const model = modelOverride ?? defaultModel;
  const outputConfig = outputConfigFor(model, effortOverride, defaultEffort);

  if (!callbacks) {
    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      ...(system ? { system } : {}),
      ...outputConfig,
      messages,
    });
    if (onUsage) onUsage(addUsage(emptyUsage(), response.usage), model);
    return extractText(response.content);
  }

  const stream = client.messages.stream({
    model,
    max_tokens: 64000,
    ...(system ? { system } : {}),
    ...outputConfig,
    messages,
  }, { signal: callbacks.signal });

  stream.on('text', (delta) => callbacks.onChunk(delta));
  const finalMessage = await stream.finalMessage();
  if (onUsage) onUsage(addUsage(emptyUsage(), finalMessage.usage), model);
  return extractText(finalMessage.content);
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
  const { client, model: defaultModel, web, effort: defaultEffort } = await getClient();
  const model = options.model ?? defaultModel;
  const outputConfig = outputConfigFor(model, options.effort, defaultEffort);
  const { toolContext, callbacks, maxIterations = 10 } = options;
  const messages: Anthropic.MessageParam[] = [...options.messages];

  const system: Anthropic.TextBlockParam[] = [
    {
      type: 'text',
      text: options.system,
      cache_control: { type: 'ephemeral' },
    },
  ];

  const tools = buildConversationTools({
    web: {
      enabled: web.enabled,
      allowedDomains: web.allowedDomains,
      blockedDomains: web.blockedDomains,
    },
    extraTools: options.extraTools,
  });

  const textPieces: string[] = [];
  const citationMap = new Map<string, Citation>();
  // Per-turn usage total, summed across every loop iteration below. Reading
  // only the final iteration's usage would under-report tool-heavy turns by
  // however many tool round-trips it took to get there (#820).
  const usage = emptyUsage();
  // Code-execution sandbox id, threaded across iterations AND across
  // turns of the same conversation. The newer web_search_20260209 /
  // web_fetch_20260209 tools surface as `server_tool_use` blocks of
  // type `code_execution`; once the API spins up a container, every
  // subsequent request whose `messages` history still references
  // those tool-use blocks must echo `container: <id>` back or the API
  // 400s with "container_id is required when there are pending tool
  // uses generated by code execution with tools." Seeded from the
  // caller (Conversation.containerId) so the next turn picks up where
  // the prior turn left off; captured fresh on every iteration so the
  // most-recent id wins.
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

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const streamParams: Anthropic.MessageStreamParams = {
      model,
      max_tokens: 64000,
      system,
      tools,
      messages,
      ...outputConfig,
    };
    if (containerId) streamParams.container = containerId;
    // Per-iteration diagnostic so the "container_id is required" 400s
    // are easy to root-cause. Logs iteration number, whether we're
    // passing a container, and a histogram of block types in the
    // accumulated messages array — code_execution / server_tool_use
    // here without a container is the smoking gun.
    if (process.env.MINERVA_LLM_DEBUG) {
      const blockHist: Record<string, number> = {};
      for (const m of messages) {
        if (typeof m.content === 'string') continue;
        for (const b of m.content) {
          const t = (b as { type?: string }).type ?? '?';
          blockHist[t] = (blockHist[t] ?? 0) + 1;
        }
      }
      console.log(
        `[llm] iter=${iteration} container=${containerId ?? 'null'} ` +
        `messageCount=${messages.length} blocks=${JSON.stringify(blockHist)}`,
      );
    }
    const stream = client.messages.stream(
      streamParams,
      { signal: callbacks?.signal },
    );

    // Track which tool-use blocks we've already surfaced as live
    // indicators so the post-finalMessage iteration below doesn't
    // double-push them. The contentBlock event fires the moment the
    // model finishes emitting a tool-use block (before the API
    // executes the server tool / before our client-side dispatch
    // runs), so users see "🔍 Searching the web for X" *during* the
    // wait rather than after the iteration completes.
    const liveEmittedToolUseIds = new Set<string>();
    stream.on('contentBlock', (block) => {
      if (block.type !== 'tool_use' && block.type !== 'server_tool_use') return;
      const indicator = `\n\n_${formatToolCall(block.name, block.input)}…_\n\n`;
      textPieces.push(indicator);
      if (callbacks) callbacks.onChunk(indicator);
      liveEmittedToolUseIds.add(block.id);
    });

    if (callbacks) {
      stream.on('text', (delta) => callbacks.onChunk(delta));
    }

    const message = await stream.finalMessage();
    addUsage(usage, message.usage);
    messages.push({ role: 'assistant', content: message.content });
    // Hold on to the container so the next iteration of this same
    // agent turn can reuse it. Don't clear if a later iteration's
    // response has `container: null` — the sandbox can persist across
    // intermediate non-code-execution turns and the API still wants
    // the id echoed.
    if (message.container?.id) {
      containerId = message.container.id;
      containerExpiresAt = message.container.expires_at ?? null;
    }

    for (const block of message.content) {
      if (block.type === 'text') {
        textPieces.push(block.text);
        collectCitations(block, citationMap);
      } else if (block.type === 'server_tool_use' && !liveEmittedToolUseIds.has(block.id)) {
        // Fallback path — if the SDK didn't fire `contentBlock` for
        // this block for some reason, recover the indicator here.
        const indicator = `\n\n_${formatToolCall(block.name, block.input)}…_\n\n`;
        textPieces.push(indicator);
        if (callbacks) callbacks.onChunk(indicator);
      }
    }

    // Server-side tool loop (e.g. web_search) can hit its internal iteration
    // cap and return pause_turn. The API expects us to re-send the same
    // conversation so it can resume where it left off — no extra user message.
    if (message.stop_reason === 'pause_turn') {
      continue;
    }

    if (message.stop_reason !== 'tool_use') {
      break;
    }

    const toolUses = message.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    // If the model stopped for tool_use but only emitted server_tool_use
    // blocks (which we don't execute), we'd loop forever. Guard against it.
    if (toolUses.length === 0) break;

    const toolResults: Anthropic.ToolResultBlockParam[] = [];
    for (const use of toolUses) {
      console.log(`[conv] tool call: ${use.name}`, JSON.stringify(use.input).slice(0, 200));
      // Indicator was already streamed live via the `contentBlock`
      // listener above (and pushed to textPieces) the moment the model
      // finished emitting this tool-use block — i.e. before the wait
      // for our local executor. Re-push only if the live emit somehow
      // missed it (SDK version drift, etc.), so the persisted transcript
      // still carries the indicator inline.
      if (!liveEmittedToolUseIds.has(use.id)) {
        const indicator = `\n\n_${formatToolCall(use.name, use.input)}…_\n\n`;
        textPieces.push(indicator);
        if (callbacks) callbacks.onChunk(indicator);
      }
      const toolCallbacks: ToolCallbacks = {};
      if (callbacks?.onDraft) {
        toolCallbacks.onDraft = callbacks.onDraft;
      }
      if (callbacks?.onSourceDraft) {
        toolCallbacks.onSourceDraft = callbacks.onSourceDraft;
      }
      if (callbacks?.onPropertyDraft) {
        toolCallbacks.onPropertyDraft = callbacks.onPropertyDraft;
      }
      if (callbacks?.onSourcePropertyDraft) {
        toolCallbacks.onSourcePropertyDraft = callbacks.onSourcePropertyDraft;
      }
      if (callbacks?.onClaimsDraft) {
        toolCallbacks.onClaimsDraft = callbacks.onClaimsDraft;
      }
      if (callbacks?.onComputeDraft) {
        toolCallbacks.onComputeDraft = callbacks.onComputeDraft;
      }
      if (callbacks?.askUser) {
        toolCallbacks.askUser = callbacks.askUser;
      }
      const { content, isError } = await executeNotebaseTool(
        toolContext,
        use.name,
        use.input,
        toolCallbacks,
      );
      if (isError) {
        console.warn(`[conv] tool ${use.name} returned error:`, content.slice(0, 300));
      }
      toolResults.push({
        type: 'tool_result',
        tool_use_id: use.id,
        content,
        ...(isError ? { is_error: true } : {}),
      });
    }

    messages.push({ role: 'user', content: toolResults });

    // Track runs of all-error iterations and bail out of a wedged retry loop.
    const allErrored = toolResults.length > 0 && toolResults.every((r) => r.is_error);
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

function collectCitations(
  block: Anthropic.TextBlock,
  acc: Map<string, Citation>,
): void {
  if (!block.citations) return;
  for (const c of block.citations) {
    if (c.type !== 'web_search_result_location') continue;
    if (!c.url) continue;
    if (acc.has(c.url)) continue;
    acc.set(c.url, {
      url: c.url,
      title: c.title ?? undefined,
      citedText: c.cited_text,
    });
  }
}

function emptyUsage(): TurnUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
}

/**
 * Fold one API response's `usage` into a running per-turn total. Kept distinct
 * by token kind (plain input vs cache read vs cache write) so #821 can price
 * each at its own rate. Mutates and returns `acc` for terse call sites in the
 * agentic loop.
 */
function addUsage(acc: TurnUsage, usage: Anthropic.Usage | undefined): TurnUsage {
  if (!usage) return acc;
  acc.inputTokens += usage.input_tokens ?? 0;
  acc.outputTokens += usage.output_tokens ?? 0;
  acc.cacheCreationTokens += usage.cache_creation_input_tokens ?? 0;
  acc.cacheReadTokens += usage.cache_read_input_tokens ?? 0;
  return acc;
}

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
