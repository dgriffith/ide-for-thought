/**
 * Fetch `Response` builders for MCP HTTP transport tests (#2029). Uses the
 * real global `Response`/`ReadableStream` (Node's undici-based fetch
 * implementation, no polyfill needed) rather than hand-rolled stand-ins, so
 * `http-common.ts`'s `.headers.get()`/`.status`/`.body.getReader()`/`.text()`
 * calls exercise real behavior.
 */

export interface SseFrameInput {
  event?: string;
  id?: string;
  data: unknown;
}

function frameText(frame: SseFrameInput): string {
  let s = '';
  if (frame.event) s += `event: ${frame.event}\n`;
  if (frame.id) s += `id: ${frame.id}\n`;
  s += `data: ${typeof frame.data === 'string' ? frame.data : JSON.stringify(frame.data)}\n\n`;
  return s;
}

export function jsonResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

/** A single-shot SSE response body (the shape both eras use for a normal
 *  request/response call) — every frame is written up front. */
export function sseResponse(status: number, frames: SseFrameInput[], headers: Record<string, string> = {}): Response {
  const text = frames.map(frameText).join('');
  return new Response(text, { status, headers: { 'content-type': 'text/event-stream', ...headers } });
}

export function emptyResponse(status: number, headers: Record<string, string> = {}): Response {
  return new Response(null, { status, headers });
}

export interface OpenSseStream {
  response: Response;
  push(frame: SseFrameInput): void;
  close(): void;
  error(err: unknown): void;
}

/** A long-lived SSE stream you push frames into on demand — models the
 *  legacy GET stream, which stays open across multiple server-initiated
 *  messages rather than closing after one reply. */
export function openSseStream(status = 200, headers: Record<string, string> = {}): OpenSseStream {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(c) {
      controller = c;
    },
  });
  const encoder = new TextEncoder();
  return {
    response: new Response(stream, { status, headers: { 'content-type': 'text/event-stream', ...headers } }),
    push: (frame) => controller.enqueue(encoder.encode(frameText(frame))),
    close: () => controller.close(),
    error: (err) => controller.error(err),
  };
}
