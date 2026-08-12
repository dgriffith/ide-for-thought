/**
 * The OpenAI implementation of the provider seam (BYOM #1495).
 *
 * The second `LLMProvider`. Like `anthropic.ts` it is the ONLY place the
 * `openai` SDK is imported; everything OpenAI-specific — Chat Completions
 * message/tool shapes, streamed tool-call fragment reassembly, `reasoning_effort`,
 * `max_completion_tokens`, and usage field names — is translated to and from the
 * neutral types in `./types` here. The agentic loop in `../index.ts` sees none
 * of it.
 *
 * The same implementation serves OpenAI-compatible local endpoints (Ollama, LM
 * Studio, vLLM, …) via a custom `baseURL` — that's BYOM #1497; the constructor
 * already takes one.
 *
 * NOT ported from Anthropic (no cross-provider equivalent, so intentionally
 * absent): prompt-cache breakpoints, server-side web search/fetch + citations,
 * and the code-execution container. `web`/`containerId` on the request are
 * ignored here; `citations` comes back empty.
 */
import OpenAI from 'openai';
import type { TurnUsage } from '../../../shared/types';
import type { ConnectionCheckResult } from '../../../shared/tools/types';
import { toConnectionResult } from '../connection-error';
import { PROVIDERS, type ProviderId } from '../../../shared/tools/providers';
import type { Effort } from '../../../shared/tools/effort';
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ProviderMessage,
  ProviderToolCall,
  ProviderToolResult,
  StopReason,
  ToolSpec,
  TurnHooks,
  TurnRequest,
  TurnResult,
} from './types';

type ChatMsg = OpenAI.Chat.Completions.ChatCompletionMessageParam;

/**
 * A conservative output-token ceiling. The loop hands us Anthropic's 64k budget
 * (`../index.ts`), which exceeds some OpenAI models' `max_completion_tokens`
 * limit and would 400. Reasoning tokens also count toward this, so it must be
 * comfortably large; 32k clears typical turns for every model we ship. Per-model
 * caps are a refinement for the skill-validation initiative.
 */
const MAX_OUTPUT_TOKENS = 32_000;

function emptyUsage(): TurnUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
}

/** Map neutral effort → OpenAI `reasoning_effort`. Levels above `high` (xhigh/
 *  max) clamp to `high` — the caller has already clamped to the model's
 *  supported set (effort.ts SUPPORT), so a non-reasoning model never reaches
 *  here with an effort. */
export function reasoningEffortFor(effort: Effort | undefined): 'low' | 'medium' | 'high' | undefined {
  if (!effort) return undefined;
  return effort === 'low' || effort === 'medium' ? effort : 'high';
}

/** ToolSpec (`{name, description, input_schema}`) → OpenAI function tool. */
export function toChatTools(specs: ToolSpec[]): OpenAI.Chat.Completions.ChatCompletionTool[] {
  return specs.map((s) => ({
    type: 'function',
    function: {
      name: s.name,
      ...(s.description ? { description: s.description } : {}),
      parameters: s.input_schema,
    },
  }));
}

export function mapFinishReason(reason: string | null | undefined): StopReason {
  if (reason === 'tool_calls') return 'tool_use';
  return 'end';
}

/** OpenAI usage → neutral TurnUsage. Cached prompt tokens are counted as full
 *  input (a slight over-estimate) rather than mapped onto Anthropic's cache-read
 *  price multiplier, which doesn't match OpenAI's cached-input rate. */
export function foldOpenAIUsage(usage: OpenAI.Completions.CompletionUsage | undefined): TurnUsage {
  if (!usage) return emptyUsage();
  return {
    inputTokens: usage.prompt_tokens ?? 0,
    outputTokens: usage.completion_tokens ?? 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
}

/** Parse a streamed tool-call's accumulated JSON `arguments`, tolerating a
 *  malformed/empty string (→ `{}`) rather than throwing mid-loop. */
export function parseToolArgs(args: string): unknown {
  if (!args) return {};
  try {
    return JSON.parse(args);
  } catch {
    return {};
  }
}

export class OpenAIProvider implements LLMProvider {
  readonly id: string;
  private readonly client: OpenAI;

  /** `client` is injectable for tests; production passes only key + baseURL.
   *  An empty key (keyless local endpoints, #1497) is replaced with a dummy the
   *  SDK accepts — those servers ignore it. `id` lets a local OpenAI-compatible
   *  endpoint report `'local'` for provenance while reusing this implementation. */
  constructor(apiKey: string, baseURL?: string, client?: OpenAI, id = 'openai') {
    this.id = id;
    this.client = client ?? new OpenAI({ apiKey: apiKey || 'no-key', ...(baseURL ? { baseURL } : {}) });
  }

  // A ProviderMessage is a CHUNK of native messages (an array). A seed turn and
  // an assistant turn are one-element chunks; a batch of tool results is a
  // multi-element chunk — OpenAI needs one `role:'tool'` message per call. The
  // loop only ever holds these opaquely; `runTurn` flattens them.
  ingestHistory(messages: ChatMessage[]): ProviderMessage[] {
    return messages.map((m) => [{ role: m.role, content: m.content }] as ChatMsg[] as unknown as ProviderMessage);
  }

  toolResultMessage(results: ProviderToolResult[]): ProviderMessage {
    const msgs: ChatMsg[] = results.map((r) => ({
      role: 'tool',
      tool_call_id: r.toolUseId,
      content: r.content,
    }));
    return msgs as unknown as ProviderMessage;
  }

  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    const messages: ChatMsg[] = [
      { role: 'system', content: req.system },
      ...(req.history as unknown as ChatMsg[][]).flat(),
    ];

    const reasoning = reasoningEffortFor(req.effort);
    const stream = await this.client.chat.completions.create(
      {
        model: req.model,
        messages,
        stream: true,
        stream_options: { include_usage: true },
        max_completion_tokens: Math.min(req.maxTokens, MAX_OUTPUT_TOKENS),
        ...(req.tools.length > 0 ? { tools: toChatTools(req.tools) } : {}),
        ...(reasoning ? { reasoning_effort: reasoning } : {}),
      },
      { signal: req.signal },
    );

    let text = '';
    // Streamed tool calls arrive as fragments keyed by `index`; reassemble id +
    // name + argument text across chunks.
    const toolAcc = new Map<number, { id: string; name: string; args: string }>();
    const emitted = new Set<number>();
    let finishReason: string | null | undefined;
    let usage: OpenAI.Completions.CompletionUsage | undefined;

    for await (const chunk of stream) {
      const choice = chunk.choices[0];
      const delta = choice?.delta;
      if (delta?.content) {
        text += delta.content;
        hooks.onTextDelta?.(delta.content);
      }
      for (const tc of delta?.tool_calls ?? []) {
        const cur = toolAcc.get(tc.index) ?? { id: '', name: '', args: '' };
        if (tc.id) cur.id = tc.id;
        if (tc.function?.name) cur.name = tc.function.name;
        if (tc.function?.arguments) cur.args += tc.function.arguments;
        toolAcc.set(tc.index, cur);
        // Fire the indicator as soon as the name is known (args still streaming).
        if (cur.name && !emitted.has(tc.index)) {
          emitted.add(tc.index);
          hooks.onToolCallStart?.(cur.name, {});
        }
      }
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (chunk.usage) usage = chunk.usage;
    }

    const calls = [...toolAcc.values()];
    const toolCalls: ProviderToolCall[] = calls.map((t) => ({
      id: t.id,
      name: t.name,
      input: parseToolArgs(t.args),
    }));

    const assistant: ChatMsg = {
      role: 'assistant',
      content: text || null,
      ...(calls.length > 0
        ? {
            tool_calls: calls.map((t) => ({
              id: t.id,
              type: 'function' as const,
              function: { name: t.name, arguments: t.args },
            })),
          }
        : {}),
    };

    return {
      assistantMessage: [assistant] as ChatMsg[] as unknown as ProviderMessage,
      text,
      toolCalls,
      citations: [],
      usage: foldOpenAIUsage(usage),
      stopReason: mapFinishReason(finishReason),
    };
  }

  async complete(req: CompletionRequest, onDelta?: (delta: string) => void): Promise<CompletionResult> {
    const messages: ChatMsg[] = [
      ...(req.system ? [{ role: 'system' as const, content: req.system }] : []),
      ...req.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
    const reasoning = reasoningEffortFor(req.effort);
    const base = {
      model: req.model,
      messages,
      max_completion_tokens: Math.min(req.maxTokens, MAX_OUTPUT_TOKENS),
      ...(reasoning ? { reasoning_effort: reasoning } : {}),
    };

    if (!onDelta) {
      const res = await this.client.chat.completions.create(base, { signal: req.signal });
      return { text: res.choices[0]?.message?.content ?? '', usage: foldOpenAIUsage(res.usage) };
    }

    const stream = await this.client.chat.completions.create(
      { ...base, stream: true, stream_options: { include_usage: true } },
      { signal: req.signal },
    );
    let text = '';
    let usage: OpenAI.Completions.CompletionUsage | undefined;
    for await (const chunk of stream) {
      const d = chunk.choices[0]?.delta?.content;
      if (d) {
        text += d;
        onDelta(d);
      }
      if (chunk.usage) usage = chunk.usage;
    }
    return { text, usage: foldOpenAIUsage(usage) };
  }

  async checkConnection(): Promise<ConnectionCheckResult> {
    // A minimal authenticated GET: no tokens spent. Any success means the key +
    // endpoint are accepted.
    // `this.id` distinguishes OpenAI proper from a `local` OpenAI-compatible
    // endpoint, so the failure names whichever one the user configured.
    return toConnectionResult(
      () => this.client.models.list(),
      PROVIDERS[this.id as ProviderId]?.label ?? this.id,
    );
  }
}
