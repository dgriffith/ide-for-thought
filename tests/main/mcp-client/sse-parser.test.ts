/**
 * Pure `text/event-stream` frame parsing (#2029) — no I/O. Covers the
 * shapes a real server produces (verified against
 * `@modelcontextprotocol/server-everything`'s `event: message\nid: <uuid>\ndata: {...}\n\n`
 * framing) plus the edge cases a hand-rolled parser has to get right:
 * chunk-boundary splits, multi-line `data:`, comments, CRLF, and the
 * buffer-limit guard.
 */
import { describe, it, expect } from 'vitest';
import { SseFrameParser } from '../../../src/main/mcp-client/http/sse-parser';
import { McpProtocolError } from '../../../src/main/mcp-client/errors';

describe('SseFrameParser (#2029)', () => {
  it('parses a single frame with event, id, and data', () => {
    const parser = new SseFrameParser();
    const frames = parser.push('event: message\nid: abc-123\ndata: {"ok":true}\n\n');
    expect(frames).toEqual([{ event: 'message', id: 'abc-123', data: '{"ok":true}' }]);
  });

  it('joins multiple data: lines with a newline', () => {
    const parser = new SseFrameParser();
    const frames = parser.push('data: line1\ndata: line2\n\n');
    expect(frames).toEqual([{ data: 'line1\nline2' }]);
  });

  it('handles a frame split across multiple push() calls', () => {
    const parser = new SseFrameParser();
    expect(parser.push('event: mess')).toEqual([]);
    expect(parser.push('age\ndata: {"a":1}')).toEqual([]);
    expect(parser.push('\n\n')).toEqual([{ event: 'message', data: '{"a":1}' }]);
  });

  it('ignores comment / keep-alive lines', () => {
    const parser = new SseFrameParser();
    const frames = parser.push(': keep-alive\ndata: hi\n\n');
    expect(frames).toEqual([{ data: 'hi' }]);
  });

  it('handles CRLF line endings', () => {
    const parser = new SseFrameParser();
    const frames = parser.push('event: message\r\ndata: hi\r\n\r\n');
    expect(frames).toEqual([{ event: 'message', data: 'hi' }]);
  });

  it('parses multiple frames delivered in one chunk', () => {
    const parser = new SseFrameParser();
    const frames = parser.push('data: one\n\ndata: two\n\n');
    expect(frames).toEqual([{ data: 'one' }, { data: 'two' }]);
  });

  it('flush() emits a trailing frame whose last line has no terminating newline at all', () => {
    const parser = new SseFrameParser();
    // No trailing "\n" — the line itself never completes during push(), so it
    // sits in the internal buffer until flush() consumes it directly.
    expect(parser.push('data: trailing')).toEqual([]);
    expect(parser.flush()).toEqual([{ data: 'trailing' }]);
  });

  it('flush() emits a trailing frame whose last line DID end in a newline but had no blank-line terminator', () => {
    const parser = new SseFrameParser();
    expect(parser.push('data: trailing\n')).toEqual([]);
    expect(parser.flush()).toEqual([{ data: 'trailing' }]);
  });

  it('flush() on an empty buffer returns nothing', () => {
    const parser = new SseFrameParser();
    parser.push('data: one\n\n');
    expect(parser.flush()).toEqual([]);
  });

  it('accepts a Uint8Array chunk', () => {
    const parser = new SseFrameParser();
    const frames = parser.push(new TextEncoder().encode('data: hi\n\n'));
    expect(frames).toEqual([{ data: 'hi' }]);
  });

  it('throws when an unterminated frame exceeds the buffer limit', () => {
    const parser = new SseFrameParser();
    const huge = 'x'.repeat(11 * 1024 * 1024);
    expect(() => parser.push(`data: ${huge}`)).toThrow(McpProtocolError);
  });
});
