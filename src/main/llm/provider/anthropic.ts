/**
 * The Anthropic implementation of the provider seam (#1148).
 *
 * This is the ONLY file under `src/main/llm/` that imports `@anthropic-ai/sdk`
 * (alongside the settings module, which only reads model ids). Everything
 * Claude-specific — the client, message/tool-result block shapes, streaming
 * events, `output_config.effort`, server-side web tools, code-execution
 * `container` ids, usage-field names, and web-search citations — is translated
 * to and from the neutral types in `./types` here. The agentic loop in
 * `../index.ts` sees none of it.
 */
import Anthropic from '@anthropic-ai/sdk';
import type { Citation, TurnUsage } from '../../../shared/conversation';
import type { ConnectionCheckResult } from '../../../shared/tools/types';
import { toConnectionResult } from '../connection-error';
import { PROVIDERS } from '../../../shared/tools/providers';
import { withHistoryCacheBreakpoints } from './anthropic-cache';
import type { Effort } from '../../../shared/tools/effort';
import type {
  ChatMessage,
  CompletionRequest,
  CompletionResult,
  LLMProvider,
  ProviderMessage,
  ProviderToolResult,
  StopReason,
  ToolSpec,
  TurnHooks,
  TurnRequest,
  TurnResult,
  WebToolSettings,
} from './types';
import { logger } from '../../../shared/logger';

/** `output_config` for a resolved effort, or `undefined` to omit it. Effort has
 *  already been clamped to the model by the caller; a falsy value means the
 *  model doesn't take one (e.g. Haiku), so we send nothing. */
function outputConfigFor(
  effort: Effort | undefined,
): { output_config: { effort: Effort } } | undefined {
  return effort ? { output_config: { effort } } : undefined;
}

/**
 * Server-side tools run on Anthropic's infrastructure — we declare them in the
 * request and the API executes queries/fetches and returns structured
 * citations. Version _20260209 bundles dynamic filtering. `allowed_domains` /
 * `blocked_domains` pass through per user setting (mutually exclusive from the
 * model's perspective, but the API accepts either independently).
 */
function buildWebTools(web: WebToolSettings): Anthropic.Messages.ToolUnion[] {
  const webSearch: Anthropic.Messages.WebSearchTool20260209 = {
    type: 'web_search_20260209',
    name: 'web_search',
  };
  const webFetch: Anthropic.Messages.WebFetchTool20260209 = {
    type: 'web_fetch_20260209',
    name: 'web_fetch',
  };
  if (web.allowedDomains && web.allowedDomains.length > 0) {
    webSearch.allowed_domains = web.allowedDomains;
    webFetch.allowed_domains = web.allowedDomains;
  } else if (web.blockedDomains && web.blockedDomains.length > 0) {
    webSearch.blocked_domains = web.blockedDomains;
    webFetch.blocked_domains = web.blockedDomains;
  }
  return [webSearch, webFetch];
}

function emptyUsage(): TurnUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
}

/** Fold one API response's `usage` into a running total, kept distinct by token
 *  kind (plain vs cache-read vs cache-write) so #821 can price each separately. */
function foldUsage(acc: TurnUsage, usage: Anthropic.Usage | undefined): TurnUsage {
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

function collectCitations(content: Anthropic.ContentBlock[]): Citation[] {
  const acc = new Map<string, Citation>();
  for (const block of content) {
    if (block.type !== 'text' || !block.citations) continue;
    for (const c of block.citations) {
      if (c.type !== 'web_search_result_location' || !c.url || acc.has(c.url)) continue;
      acc.set(c.url, {
        url: c.url,
        ...(c.title != null ? { title: c.title } : {}),
        citedText: c.cited_text,
      });
    }
  }
  return [...acc.values()];
}

function mapStopReason(reason: Anthropic.Message['stop_reason']): StopReason {
  if (reason === 'pause_turn') return 'pause';
  if (reason === 'tool_use') return 'tool_use';
  if (reason === 'max_tokens') return 'max_tokens';
  return 'end';
}

export class AnthropicProvider implements LLMProvider {
  readonly id = 'anthropic';
  private readonly client: Anthropic;

  constructor(apiKey: string) {
    this.client = new Anthropic({ apiKey });
  }

  // History entries are Anthropic message params under the hood; the loop only
  // ever holds them as opaque `ProviderMessage`s.
  ingestHistory(messages: ChatMessage[]): ProviderMessage[] {
    return messages.map((m) => ({ role: m.role, content: m.content })) as unknown as ProviderMessage[];
  }

  toolResultMessage(results: ProviderToolResult[]): ProviderMessage {
    const content: Anthropic.ToolResultBlockParam[] = results.map((r) => ({
      type: 'tool_result',
      tool_use_id: r.toolUseId,
      content: r.content,
      ...(r.isError ? { is_error: true } : {}),
    }));
    return { role: 'user', content } as unknown as ProviderMessage;
  }

  private buildTools(specs: ToolSpec[], web: WebToolSettings): Anthropic.Messages.ToolUnion[] {
    // ToolSpec is structurally an Anthropic.Tool (name/description/input_schema).
    const tools: Anthropic.Messages.ToolUnion[] = specs.map((s) => s as Anthropic.Tool);
    if (web.enabled) tools.push(...buildWebTools(web));
    return tools;
  }

  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    // Tools render before system, so this one marker caches BOTH — the tool
    // schemas and the system prompt — as a single prefix.
    const system: Anthropic.TextBlockParam[] = [
      { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
    ];
    const streamParams: Anthropic.MessageStreamParams = {
      model: req.model,
      max_tokens: req.maxTokens,
      system,
      tools: this.buildTools(req.tools, req.web),
      // Rolling breakpoints on the history tail so each loop iteration reads
      // the transcript the previous one wrote instead of re-paying for it.
      messages: withHistoryCacheBreakpoints(req.history as unknown as Anthropic.MessageParam[]),
      ...outputConfigFor(req.effort),
    };
    if (req.containerId) streamParams.container = req.containerId;

    const stream = this.client.messages.stream(streamParams, { signal: req.signal });

    // Fire onToolCallStart the moment the model finishes a tool-use block, so the
    // indicator streams *during* the wait for our executor / the server tool.
    const emitted = new Set<string>();
    stream.on('contentBlock', (block) => {
      if (block.type !== 'tool_use' && block.type !== 'server_tool_use') return;
      emitted.add(block.id);
      hooks.onToolCallStart?.(block.name, block.input);
    });
    if (hooks.onTextDelta) stream.on('text', (delta) => hooks.onTextDelta!(delta));

    const message = await stream.finalMessage();

    if (process.env.MINERVA_LLM_DEBUG) {
      // Caching fails silently — a stray timestamp in the system prompt just
      // means `read` stays 0 forever, with no error. Surface the split so a
      // regression is visible rather than merely expensive.
      const u = message.usage;
      logger('llm').info(
        `cache read=${u?.cache_read_input_tokens ?? 0} `
        + `write=${u?.cache_creation_input_tokens ?? 0} uncached=${u?.input_tokens ?? 0}`,
      );
    }

    // Fallback for any tool-use block the streaming event missed (SDK drift),
    // so the indicator still appears exactly once.
    for (const block of message.content) {
      if (
        (block.type === 'tool_use' || block.type === 'server_tool_use') &&
        !emitted.has(block.id)
      ) {
        hooks.onToolCallStart?.(block.name, block.input);
      }
    }

    const toolCalls = message.content
      .filter((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use')
      .map((b) => ({ id: b.id, name: b.name, input: b.input }));

    return {
      assistantMessage: { role: 'assistant', content: message.content } as unknown as ProviderMessage,
      text: extractText(message.content),
      toolCalls,
      citations: collectCitations(message.content),
      usage: foldUsage(emptyUsage(), message.usage),
      stopReason: mapStopReason(message.stop_reason),
      ...(message.container?.id ? { containerId: message.container.id } : {}),
      ...(message.container?.expires_at ? { containerExpiresAt: message.container.expires_at } : {}),
    };
  }

  async complete(
    req: CompletionRequest,
    onDelta?: (delta: string) => void,
  ): Promise<CompletionResult> {
    const messages = req.messages as Anthropic.MessageParam[];
    const base = {
      model: req.model,
      // Batch callers (auto-tag, auto-link) re-send an identical system prompt
      // per note; marking it makes every call after the first a cache read.
      // Below the model's minimum cacheable prefix this is silently a no-op.
      ...(req.system
        ? {
            system: [
              { type: 'text', text: req.system, cache_control: { type: 'ephemeral' } },
            ] satisfies Anthropic.TextBlockParam[],
          }
        : {}),
      ...outputConfigFor(req.effort),
      messages,
    };

    // Always stream, even when nobody wants the deltas (#1811). A non-streaming
    // request sends no bytes until the whole response is generated, so Node's
    // 300s `headersTimeout` covers the entire generation — which is why the
    // one-shot proposal paths (auto-tag, auto-link, /compact) timed out on large
    // outputs while conversations, which stream, never did. Streaming also lifts
    // the SDK's refusal to accept a big `max_tokens` off the non-streaming path.
    const stream = this.client.messages.stream(
      { ...base, max_tokens: req.maxTokens },
      { signal: req.signal },
    );
    if (onDelta) stream.on('text', (delta) => onDelta(delta));
    const finalMessage = await stream.finalMessage();
    return {
      text: extractText(finalMessage.content),
      usage: foldUsage(emptyUsage(), finalMessage.usage),
      stopReason: mapStopReason(finalMessage.stop_reason),
    };
  }

  async checkConnection(): Promise<ConnectionCheckResult> {
    // A minimal authenticated GET: no tokens spent, model-agnostic. Any success
    // means the key is accepted.
    return toConnectionResult(() => this.client.models.list({ limit: 1 }), PROVIDERS.anthropic.label);
  }
}
