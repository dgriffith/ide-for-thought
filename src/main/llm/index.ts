import Anthropic from '@anthropic-ai/sdk';
import { getSettings } from './settings';
import {
  buildConversationTools,
  executeNotebaseTool,
  type ToolContext,
} from './tools';
import type { Citation } from '../../shared/types';
import { DEFAULT_WEB_SETTINGS } from '../../shared/tools/types';

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  signal?: AbortSignal;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompleteOptions {
  system?: string;
  messages?: ChatMessage[];
  callbacks?: StreamCallbacks;
}

export interface CompleteWithToolsOptions {
  system: string;
  messages: Anthropic.MessageParam[];
  toolContext: ToolContext;
  callbacks?: StreamCallbacks;
  /** Hard cap on tool-use iterations. Defaults to 10. */
  maxIterations?: number;
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
  const { client, model } = await getClient();

  let system: string | undefined;
  let messages: Anthropic.MessageParam[];
  let callbacks: StreamCallbacks | undefined;

  if (callbacksOrOptions && 'onChunk' in callbacksOrOptions) {
    callbacks = callbacksOrOptions;
    messages = [{ role: 'user', content: prompt }];
  } else if (callbacksOrOptions) {
    const opts = callbacksOrOptions as CompleteOptions;
    system = opts.system;
    callbacks = opts.callbacks;
    messages = (opts.messages ?? [{ role: 'user', content: prompt }]) as Anthropic.MessageParam[];
  } else {
    messages = [{ role: 'user', content: prompt }];
  }

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

  stream.on('text', (delta) => callbacks!.onChunk(delta));
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
  const { client, model, web } = await getClient();
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
      if (callbacks) {
        callbacks.onChunk(`\n\n_Running \`${use.name}\`..._\n\n`);
      }
      const { content, isError } = await executeNotebaseTool(
        toolContext,
        use.name,
        use.input,
      );
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
