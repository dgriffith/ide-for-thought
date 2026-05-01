import Anthropic from '@anthropic-ai/sdk';
import { getSettings } from './settings';
import {
  buildConversationTools,
  executeNotebaseTool,
  type ToolContext,
  type ToolCallbacks,
} from './tools';
import type { Citation } from '../../shared/types';
import { DEFAULT_WEB_SETTINGS } from '../../shared/tools/types';
import type { ConversationDraft } from '../../shared/conversation-drafts';
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
}

export interface CompleteWithToolsResult {
  text: string;
  citations: Citation[];
}

async function getClient(): Promise<{
  client: Anthropic;
  model: string;
  web: NonNullable<Awaited<ReturnType<typeof getSettings>>['web']>;
}> {
  const settings = await getSettings();
  if (!settings.apiKey) {
    throw new Error(
      'Anthropic API key not configured. Set it in the LLM settings or ANTHROPIC_API_KEY environment variable.',
    );
  }
  return {
    client: new Anthropic({ apiKey: settings.apiKey }),
    model: settings.model,
    web: settings.web ?? { ...DEFAULT_WEB_SETTINGS },
  };
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

  if (callbacksOrOptions && 'onChunk' in callbacksOrOptions) {
    callbacks = callbacksOrOptions;
    messages = [{ role: 'user', content: prompt }];
  } else if (callbacksOrOptions) {
    const opts = callbacksOrOptions;
    system = opts.system;
    callbacks = opts.callbacks;
    modelOverride = opts.model;
    messages = (opts.messages ?? [{ role: 'user', content: prompt }]);
  } else {
    messages = [{ role: 'user', content: prompt }];
  }

  const { client, model: defaultModel } = await getClient();
  const model = modelOverride ?? defaultModel;

  if (!callbacks) {
    const response = await client.messages.create({
      model,
      max_tokens: 16000,
      ...(system ? { system } : {}),
      messages,
    });
    return extractText(response.content);
  }

  const stream = client.messages.stream({
    model,
    max_tokens: 64000,
    ...(system ? { system } : {}),
    messages,
  }, { signal: callbacks.signal });

  stream.on('text', (delta) => callbacks.onChunk(delta));
  const finalMessage = await stream.finalMessage();
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
  const { client, model: defaultModel, web } = await getClient();
  const model = options.model ?? defaultModel;
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
  });

  const textPieces: string[] = [];
  const citationMap = new Map<string, Citation>();

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const stream = client.messages.stream(
      {
        model,
        max_tokens: 64000,
        system,
        tools,
        messages,
      },
      { signal: callbacks?.signal },
    );

    if (callbacks) {
      stream.on('text', (delta) => callbacks.onChunk(delta));
    }

    const message = await stream.finalMessage();
    messages.push({ role: 'assistant', content: message.content });

    for (const block of message.content) {
      if (block.type === 'text') {
        textPieces.push(block.text);
        collectCitations(block, citationMap);
      } else if (block.type === 'server_tool_use') {
        // Server-side tools (web_search, web_fetch) execute in the API
        // and never round-trip through our client-side dispatch — but
        // the user still pays for the wall-clock wait, so surface them
        // in the stream the same way we do client-side tool calls.
        // Push to textPieces too so the indicator persists in the saved
        // assistant message (the live stream gets cleared on reload).
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
      // Persist the indicator alongside the live-stream notice so it
      // survives conversation reload and reads inline with the rest
      // of the assistant's text.
      const indicator = `\n\n_${formatToolCall(use.name, use.input)}…_\n\n`;
      textPieces.push(indicator);
      if (callbacks) callbacks.onChunk(indicator);
      const toolCallbacks: ToolCallbacks = {};
      if (callbacks?.onDraft) {
        toolCallbacks.onDraft = callbacks.onDraft;
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
  }

  return { text: textPieces.join(''), citations: [...citationMap.values()] };
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

function extractText(content: Anthropic.ContentBlock[]): string {
  return content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('');
}
