/**
 * Pure `text/event-stream` (SSE) frame parser (#2029). No I/O — buffers
 * chunks across arbitrary boundaries and emits complete frames. Needed
 * because no SSE-parsing code exists anywhere in this codebase yet (the
 * only existing streaming-HTTP consumer, `src/main/llm/provider/anthropic.ts`,
 * rides entirely on the Anthropic SDK's own stream object) and no
 * `eventsource`-style dependency is installed — hand-rolled per the
 * codebase's established "hand-roll protocol plumbing" convention
 * (`src/cli/mcp.ts`).
 */
import { McpProtocolError } from '../errors';

export interface SseFrame {
  event?: string;
  id?: string;
  data: string;
}

/** A single unterminated frame growing past this throws rather than
 *  buffering unbounded — a misbehaving server must not be able to exhaust
 *  memory through this parser. */
const MAX_BUFFER_LENGTH = 10 * 1024 * 1024;

interface FrameBuilder {
  event?: string;
  id?: string;
  dataLines: string[];
}

function emptyBuilder(): FrameBuilder {
  return { dataLines: [] };
}

function isEmpty(b: FrameBuilder): boolean {
  return b.event === undefined && b.id === undefined && b.dataLines.length === 0;
}

export class SseFrameParser {
  private buffer = '';
  private current: FrameBuilder = emptyBuilder();

  /** Feed a chunk; returns every complete frame the chunk finished, in order. */
  push(chunk: Uint8Array | string): SseFrame[] {
    const text = typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf-8');
    this.buffer += text;
    if (this.buffer.length > MAX_BUFFER_LENGTH) {
      throw new McpProtocolError('SSE frame exceeded buffer limit — unterminated stream');
    }

    const frames: SseFrame[] = [];
    let idx: number;
    while ((idx = this.buffer.indexOf('\n')) >= 0) {
      let line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      if (line === '') {
        if (!isEmpty(this.current)) frames.push(this.finalize());
        this.current = emptyBuilder();
        continue;
      }
      this.consumeLine(line);
    }
    return frames;
  }

  /** Call at stream end for a trailing frame that never got its terminating
   *  blank line (lenient — the spec expects one, real servers sometimes omit it). */
  flush(): SseFrame[] {
    if (this.buffer.length > 0) {
      this.consumeLine(this.buffer);
      this.buffer = '';
    }
    if (isEmpty(this.current)) return [];
    const frame = this.finalize();
    this.current = emptyBuilder();
    return [frame];
  }

  private consumeLine(line: string): void {
    if (line.startsWith(':')) return; // comment / keep-alive — ignored
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'event') this.current.event = value;
    else if (field === 'id') this.current.id = value;
    else if (field === 'data') this.current.dataLines.push(value);
    // `retry` and unrecognized fields are ignored — not needed for v1.
  }

  private finalize(): SseFrame {
    const frame: SseFrame = { data: this.current.dataLines.join('\n') };
    if (this.current.event !== undefined) frame.event = this.current.event;
    if (this.current.id !== undefined) frame.id = this.current.id;
    return frame;
  }
}
