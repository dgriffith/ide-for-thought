/**
 * The Google (Gemini) implementation of the provider seam (BYOM #1496).
 *
 * The third `LLMProvider`, and the ONLY importer of `@google/genai`. Everything
 * Gemini-specific — `Content`/`Part` message shapes, `functionCall` /
 * `functionResponse` parts, `thinkingConfig` budgets, streamed
 * `GenerateContentResponse` getters, and `usageMetadata` field names — is
 * translated to and from the neutral types in `./types` here. The agentic loop
 * in `../index.ts` sees none of it.
 *
 * NOT ported (no cross-provider equivalent): prompt-cache breakpoints,
 * server-side web search + citations, and the code-execution container.
 * `web`/`containerId` on the request are ignored; `citations` comes back empty.
 *
 * Function-call correlation: Gemini matches a `functionResponse` to its call by
 * NAME (with an optional `id`), unlike OpenAI/Anthropic's required call id. The
 * loop only hands `toolResultMessage` a `toolUseId` + content, so the call name
 * is encoded INTO the neutral id (`id::name`, or just `name`) and decoded back
 * when building the response part — keeping the provider stateless.
 */
import { GoogleGenAI } from '@google/genai';
import type {
  Content,
  FunctionDeclaration,
  GenerateContentConfig,
  GenerateContentResponseUsageMetadata,
  Part,
} from '@google/genai';
import type { TurnUsage } from '../../../shared/types';
import type { ConnectionCheckResult } from '../../../shared/tools/types';
import { toConnectionResult } from '../connection-error';
import { PROVIDERS } from '../../../shared/tools/providers';
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

/** Conservative output-token ceiling — see the note in `openai.ts`. Gemini
 *  counts thinking tokens separately from `maxOutputTokens`, but keep parity. */
const MAX_OUTPUT_TOKENS = 32_000;

function emptyUsage(): TurnUsage {
  return { inputTokens: 0, outputTokens: 0, cacheCreationTokens: 0, cacheReadTokens: 0 };
}

/** Map neutral effort → a Gemini `thinkingBudget` (tokens). The caller has
 *  already clamped to the model's supported set (effort.ts SUPPORT), so a
 *  non-thinking model never reaches here with an effort. */
export function thinkingBudgetFor(effort: Effort | undefined): number | undefined {
  if (!effort) return undefined;
  if (effort === 'low') return 2048;
  if (effort === 'medium') return 8192;
  return 16384; // high / xhigh / max
}

/** Gemini's `finishReason` → the neutral stop reason. Only the truncation case
 *  needs distinguishing; everything else is a normal end (#1811). */
export function mapFinishReason(reason: string | undefined): StopReason {
  return reason === 'MAX_TOKENS' ? 'max_tokens' : 'end';
}

export function foldGeminiUsage(u: GenerateContentResponseUsageMetadata | undefined): TurnUsage {
  if (!u) return emptyUsage();
  return {
    inputTokens: u.promptTokenCount ?? 0,
    outputTokens: u.candidatesTokenCount ?? 0,
    cacheCreationTokens: 0,
    cacheReadTokens: 0,
  };
}

/** Encode a call's name into the neutral id so `toolResultMessage` can recover
 *  it (Gemini responses key on name). */
export function encodeToolId(name: string, id: string | undefined): string {
  return id ? `${id}::${name}` : name;
}

/** Recover `{ id?, name }` from an encoded neutral tool id. */
export function decodeToolId(toolUseId: string): { id?: string; name: string } {
  const sep = toolUseId.indexOf('::');
  if (sep < 0) return { name: toolUseId };
  return { id: toolUseId.slice(0, sep), name: toolUseId.slice(sep + 2) };
}

export class GoogleProvider implements LLMProvider {
  readonly id = 'google';
  private readonly ai: GoogleGenAI;

  /** `ai` is injectable for tests; production passes only the key. */
  constructor(apiKey: string, ai?: GoogleGenAI) {
    this.ai = ai ?? new GoogleGenAI({ apiKey });
  }

  // A ProviderMessage is a single Gemini `Content`. The loop holds them opaquely.
  ingestHistory(messages: ChatMessage[]): ProviderMessage[] {
    return messages.map(
      (m) =>
        ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }) as Content as unknown as ProviderMessage,
    );
  }

  toolResultMessage(results: ProviderToolResult[]): ProviderMessage {
    const parts: Part[] = results.map((r) => {
      const { id, name } = decodeToolId(r.toolUseId);
      return {
        functionResponse: {
          ...(id ? { id } : {}),
          name,
          response: r.isError ? { error: r.content } : { result: r.content },
        },
      };
    });
    return { role: 'user', parts } as Content as unknown as ProviderMessage;
  }

  private buildConfig(system: string | undefined, tools: ToolSpec[], effort: Effort | undefined, signal: AbortSignal | undefined): GenerateContentConfig {
    const budget = thinkingBudgetFor(effort);
    return {
      ...(system ? { systemInstruction: system } : {}),
      maxOutputTokens: MAX_OUTPUT_TOKENS,
      ...(tools.length > 0
        ? {
            tools: [
              {
                functionDeclarations: tools.map((s): FunctionDeclaration => ({
                  name: s.name,
                  ...(s.description ? { description: s.description } : {}),
                  // Neutral JSON-Schema → Gemini's Schema. Structurally close; a
                  // schema with Gemini-incompatible fields is the skill-validation
                  // initiative's concern, not this plumbing's.
                  parameters: s.input_schema as unknown as NonNullable<FunctionDeclaration['parameters']>,
                })),
              },
            ],
          }
        : {}),
      ...(budget !== undefined ? { thinkingConfig: { thinkingBudget: budget } } : {}),
      ...(signal ? { abortSignal: signal } : {}),
    };
  }

  async runTurn(req: TurnRequest, hooks: TurnHooks): Promise<TurnResult> {
    const contents = req.history as unknown as Content[];
    const stream = await this.ai.models.generateContentStream({
      model: req.model,
      contents,
      config: this.buildConfig(req.system, req.tools, req.effort, req.signal),
    });

    let text = '';
    const calls: { id?: string; name: string; args: Record<string, unknown> }[] = [];
    let usage: GenerateContentResponseUsageMetadata | undefined;
    let finishReason: string | undefined;

    for await (const chunk of stream) {
      const t = chunk.text;
      if (t) {
        text += t;
        hooks.onTextDelta?.(t);
      }
      // Gemini emits each function call complete in one part (no partial args),
      // so fire the indicator + record it as it arrives.
      for (const fc of chunk.functionCalls ?? []) {
        const name = fc.name ?? '';
        const args = fc.args ?? {};
        hooks.onToolCallStart?.(name, args);
        calls.push({ ...(fc.id ? { id: fc.id } : {}), name, args });
      }
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
      const reason = chunk.candidates?.[0]?.finishReason;
      if (reason) finishReason = reason;
    }

    const toolCalls: ProviderToolCall[] = calls.map((c) => ({
      id: encodeToolId(c.name, c.id),
      name: c.name,
      input: c.args,
    }));

    const parts: Part[] = [
      ...(text ? [{ text }] : []),
      ...calls.map((c) => ({ functionCall: { ...(c.id ? { id: c.id } : {}), name: c.name, args: c.args } })),
    ];
    const assistant: Content = { role: 'model', parts };

    return {
      assistantMessage: assistant as unknown as ProviderMessage,
      text,
      toolCalls,
      citations: [],
      usage: foldGeminiUsage(usage),
      stopReason: calls.length > 0 ? 'tool_use' : mapFinishReason(finishReason),
    };
  }

  async complete(req: CompletionRequest, onDelta?: (delta: string) => void): Promise<CompletionResult> {
    const contents: Content[] = req.messages.map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));
    const config = this.buildConfig(req.system, [], req.effort, req.signal);

    // Always stream — see the note in `anthropic.ts`: a non-streaming request
    // sends nothing until the whole response exists, so Node's 300s
    // `headersTimeout` becomes a ceiling on generation length (#1811).
    const stream = await this.ai.models.generateContentStream({ model: req.model, contents, config });
    let text = '';
    let usage: GenerateContentResponseUsageMetadata | undefined;
    let finishReason: string | undefined;
    for await (const chunk of stream) {
      const t = chunk.text;
      if (t) {
        text += t;
        if (onDelta) onDelta(t);
      }
      if (chunk.usageMetadata) usage = chunk.usageMetadata;
      const reason = chunk.candidates?.[0]?.finishReason;
      if (reason) finishReason = reason;
    }
    return { text, usage: foldGeminiUsage(usage), stopReason: mapFinishReason(finishReason) };
  }

  async checkConnection(): Promise<ConnectionCheckResult> {
    // A minimal authenticated listing: no generation, so token-free.
    return toConnectionResult(() => this.ai.models.list(), PROVIDERS.google.label);
  }
}
