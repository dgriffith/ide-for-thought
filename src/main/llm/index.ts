import { getSettings } from './settings';

export interface StreamCallbacks {
  onChunk: (text: string) => void;
  signal?: AbortSignal;
}

export async function complete(prompt: string, callbacks?: StreamCallbacks): Promise<string> {
  const settings = await getSettings();

  if (!settings.apiKey) {
    throw new Error('Anthropic API key not configured. Set it in the LLM settings or ANTHROPIC_API_KEY environment variable.');
  }

  const body = {
    model: settings.model,
    max_tokens: 4096,
    stream: !!callbacks,
    messages: [{ role: 'user', content: prompt }],
  };

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
