import { getSettings } from './settings';

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  signal?: AbortSignal;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface CompleteOptions {
  /** System prompt (sets context for the conversation) */
  system?: string;
  /** Multi-turn message history (alternative to single prompt) */
  messages?: ChatMessage[];
  /** Streaming callbacks */
  callbacks?: StreamCallbacks;
}

/**
 * Call the Anthropic Messages API.
 * Supports single prompt (backward-compatible) or multi-turn with system prompt.
 */
export async function complete(prompt: string, callbacksOrOptions?: StreamCallbacks | CompleteOptions): Promise<string> {
  const settings = await getSettings();

  if (!settings.apiKey) {
    throw new Error('Anthropic API key not configured. Set it in the LLM settings or ANTHROPIC_API_KEY environment variable.');
  }

  // Resolve overloaded second argument
  let system: string | undefined;
  let messages: { role: string; content: string }[];
  let callbacks: StreamCallbacks | undefined;

  if (callbacksOrOptions && 'onChunk' in callbacksOrOptions) {
    // Legacy: complete(prompt, streamCallbacks)
    callbacks = callbacksOrOptions;
    messages = [{ role: 'user', content: prompt }];
  } else if (callbacksOrOptions) {
    // New: complete(prompt, { system, messages, callbacks })
    const opts = callbacksOrOptions as CompleteOptions;
    system = opts.system;
    callbacks = opts.callbacks;
    messages = opts.messages ?? [{ role: 'user', content: prompt }];
  } else {
    messages = [{ role: 'user', content: prompt }];
  }

  const body: Record<string, unknown> = {
    model: settings.model,
    max_tokens: 4096,
    stream: !!callbacks,
    messages,
  };
  if (system) body.system = system;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
    signal: callbacks?.signal,
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Anthropic API error (${response.status}): ${errorText}`);
  }

  if (!callbacks) {
    const result = await response.json();
    return result.content
      .filter((block: { type: string }) => block.type === 'text')
      .map((block: { text: string }) => block.text)
      .join('');
  }

  // Streaming response
  const reader = response.body?.getReader();
  if (!reader) throw new Error('No response body for streaming');

  const decoder = new TextDecoder();
  let accumulated = '';
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue;
      const data = line.slice(6);
      if (data === '[DONE]') continue;

      try {
        const event = JSON.parse(data);
        if (event.type === 'content_block_delta' && event.delta?.text) {
          accumulated += event.delta.text;
          callbacks.onChunk(event.delta.text);
        }
      } catch {
        // skip malformed SSE lines
      }
    }
  }

  return accumulated;
}
