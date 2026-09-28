/**
 * @vitest-environment node
 *
 * Stream-chunk coalescing (#2219).
 *
 * The gates here are COUNT-based, never timing-based. "A 610-delta reply sends
 * 610 IPC messages" is a fact about the code; "it takes 38ms" is a fact about
 * the machine that ran it. Fake timers make the count deterministic, so these
 * assert the exact number of `CONVERSATION_STREAM` sends for a given delta
 * pattern rather than a duration or a ratio.
 *
 * The three properties coalescing can break, each with its own case:
 *   - nothing is DROPPED (concatenated payloads === concatenated chunks);
 *   - nothing is REORDERED (payload order matches arrival order);
 *   - the TAIL is flushed when the turn ends, however it ends. A buffered final
 *     chunk that never ships is a silently truncated message — the worst
 *     failure available here, because it looks like the model stopped early.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Channels } from '../../../src/shared/channels';
import {
  buildStreamCallbacks,
  STREAM_COALESCE_MS,
  type PendingAskUser,
  type PendingMcpConfirm,
} from '../../../src/main/ipc/conversation-stream';

function makeWin(destroyed = false) {
  const listeners = new Map<string, Set<() => void>>();
  return {
    id: 1,
    isDestroyed: () => destroyed,
    webContents: { send: vi.fn() },
    once: (ev: string, fn: () => void) => {
      if (!listeners.has(ev)) listeners.set(ev, new Set());
      listeners.get(ev)!.add(fn);
    },
    removeListener: (ev: string, fn: () => void) => { listeners.get(ev)?.delete(fn); },
    emit: (ev: string) => { for (const fn of [...(listeners.get(ev) ?? [])]) fn(); },
    listenerCount: (ev: string) => listeners.get(ev)?.size ?? 0,
  };
}

/** Every payload sent on the stream channel, in order. */
function streamSends(win: ReturnType<typeof makeWin>): string[] {
  return win.webContents.send.mock.calls
    .filter((c) => c[0] === Channels.CONVERSATION_STREAM)
    .map((c) => c[1] as string);
}

function build(win: ReturnType<typeof makeWin>) {
  const pending: PendingAskUser = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return buildStreamCallbacks(win as any, 'conv-1', new AbortController().signal, pending);
}

function buildWithConfirm(win: ReturnType<typeof makeWin>, controller = new AbortController()) {
  const pendingMcp: PendingMcpConfirm = new Map();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handle = buildStreamCallbacks(win as any, 'conv-1', controller.signal, new Map(), pendingMcp);
  return { ...handle, pendingMcp, controller };
}

const PROMPT = { serverName: 'slack', toolName: 'post_message', argsJson: '{\n  "text": "hi"\n}' };

describe('stream chunk coalescing (#2219)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('sends far fewer IPC messages than there are deltas, for a realistic reply', () => {
    const win = makeWin();
    const { callbacks, flush } = build(win);

    // 610 deltas ~59ms apart — the measured shape of a real 2,514-token
    // claude-opus-5 reply (p50 inter-delta gap 58.8ms over 38.1s).
    const DELTAS = 610;
    const GAP = 59;
    for (let i = 0; i < DELTAS; i++) {
      callbacks.onChunk(`d${i} `);
      vi.advanceTimersByTime(GAP);
    }
    flush();

    const sends = streamSends(win);
    // Trailing 100ms window over 59ms-spaced deltas collects ~2 per flush.
    expect(sends.length).toBeLessThan(DELTAS / 1.8);
    // …and a LOWER bound, which is not symmetry for its own sake. Written with
    // only the upper bound this test passed against a debounce — see the
    // dedicated case below for why that is a worse bug than the one being
    // fixed. A 36s stream must produce hundreds of updates, not a handful.
    expect(sends.length).toBeGreaterThan(DELTAS / 4);
  });

  it('keeps painting during a continuous stream instead of withholding it all to the end', () => {
    // The failure mode a one-sided "fewer messages" assertion invites, and the
    // reason this case exists: re-arming the timer on every chunk turns the
    // throttle into a DEBOUNCE. While deltas keep arriving faster than the
    // window, the deadline is pushed forward forever and nothing ships until
    // the end-of-turn flush — the user watches a thinking indicator for the
    // whole reply and then the entire message appears at once. Strictly worse
    // than the per-chunk flood #2219 set out to fix, and every other assertion
    // in this file passes against it (verified by reintroducing it).
    const win = makeWin();
    const { callbacks, flush } = build(win);

    const DELTAS = 200;
    let sentByHalfway = 0;
    for (let i = 0; i < DELTAS; i++) {
      callbacks.onChunk(`d${i} `);
      vi.advanceTimersByTime(59);
      if (i === DELTAS / 2) sentByHalfway = streamSends(win).join('').length;
    }
    flush();

    const total = streamSends(win).join('').length;
    // Roughly half the text should already be on screen at the halfway point.
    expect(sentByHalfway).toBeGreaterThan(total * 0.3);
  });

  it('drops nothing and reorders nothing', () => {
    const win = makeWin();
    const { callbacks, flush } = build(win);

    const chunks = Array.from({ length: 200 }, (_, i) => `[${i}]`);
    for (const [i, c] of chunks.entries()) {
      callbacks.onChunk(c);
      // Deliberately irregular: bursts inside one window, then long quiet gaps.
      vi.advanceTimersByTime(i % 7 === 0 ? 250 : 5);
    }
    flush();

    // Concatenation is the whole contract — it proves no chunk was lost AND
    // that none arrived out of order, in one assertion that cannot pass by
    // accident.
    expect(streamSends(win).join('')).toBe(chunks.join(''));
  });

  it('a burst inside one window becomes exactly one send', () => {
    const win = makeWin();
    const { callbacks } = build(win);

    for (let i = 0; i < 50; i++) callbacks.onChunk('x');
    // Nothing is sent on the leading edge — the window is still open.
    expect(streamSends(win)).toEqual([]);

    vi.advanceTimersByTime(STREAM_COALESCE_MS);
    expect(streamSends(win)).toEqual(['x'.repeat(50)]);
  });

  it('flushes the tail when the stream ends mid-window', () => {
    const win = makeWin();
    const { callbacks, flush } = build(win);

    callbacks.onChunk('the final ');
    callbacks.onChunk('sentence.');
    // Turn ends well before the window would have expired.
    vi.advanceTimersByTime(STREAM_COALESCE_MS - 1);
    expect(streamSends(win)).toEqual([]);

    flush();
    expect(streamSends(win)).toEqual(['the final sentence.']);
  });

  it('flush is idempotent and disarms the pending timer', () => {
    const win = makeWin();
    const { callbacks, flush } = build(win);

    callbacks.onChunk('once');
    flush();
    flush();
    // A timer left armed would fire here and send an empty or duplicate payload.
    vi.advanceTimersByTime(STREAM_COALESCE_MS * 5);

    expect(streamSends(win)).toEqual(['once']);
  });

  it('a draft flushes buffered text first, so a card cannot overtake its lead-in', () => {
    const win = makeWin();
    const { callbacks } = build(win);

    callbacks.onChunk('Here is a note I drafted:');
    callbacks.onDraft({ conversationId: 'conv-1', draftId: 'd1' } as never);

    const order = win.webContents.send.mock.calls.map((c) => c[0]);
    expect(order).toEqual([Channels.CONVERSATION_STREAM, Channels.CONVERSATION_DRAFT]);
  });

  it('ask_user flushes buffered text first', () => {
    const win = makeWin();
    const { callbacks } = build(win);

    callbacks.onChunk('Before I continue — ');
    void callbacks.askUser?.({ question: 'which one?' });

    const order = win.webContents.send.mock.calls.map((c) => c[0]);
    expect(order).toEqual([Channels.CONVERSATION_STREAM, Channels.CONVERSATION_ASK_USER]);
  });

  it('sends nothing to a destroyed window and does not throw', () => {
    const win = makeWin(true);
    const { callbacks, flush } = build(win);

    callbacks.onChunk('orphaned');
    vi.advanceTimersByTime(STREAM_COALESCE_MS);
    flush();

    expect(streamSends(win)).toEqual([]);
  });

  it('ignores empty deltas rather than arming a window for them', () => {
    const win = makeWin();
    const { callbacks, flush } = build(win);

    callbacks.onChunk('');
    callbacks.onChunk('');
    vi.advanceTimersByTime(STREAM_COALESCE_MS * 2);
    flush();

    expect(streamSends(win)).toEqual([]);
  });
});

describe('mcp_call confirmation card (#2439)', () => {
  it('flushes the lead-in text, then sends the card to the renderer', () => {
    const win = makeWin();
    const { callbacks } = buildWithConfirm(win);
    callbacks.onChunk('I will post this: ');
    void callbacks.confirmMcpCall!(PROMPT);
    const calls = win.webContents.send.mock.calls;
    expect(calls.map((c) => c[0])).toEqual([Channels.CONVERSATION_STREAM, Channels.CONVERSATION_MCP_CONFIRM]);
    expect(calls[1]![1]).toMatchObject({ conversationId: 'conv-1', ...PROMPT, requestId: expect.any(String) });
  });

  it('resolves with the settled decision and cleans up', async () => {
    const win = makeWin();
    const { callbacks, pendingMcp } = buildWithConfirm(win);
    const p = callbacks.confirmMcpCall!(PROMPT);
    expect(pendingMcp.size).toBe(1);
    const [, entry] = [...pendingMcp][0]!;
    entry.settle({ allow: true, remember: true });
    await expect(p).resolves.toEqual({ allow: true, remember: true });
    expect(pendingMcp.size).toBe(0);
    expect(win.listenerCount('closed')).toBe(0);
    // A second settle is a no-op, not a second resolution.
    entry.settle({ allow: false, reason: 'denied' });
  });

  it('stopping the turn resolves a pending card as cancelled, leaving nothing behind', async () => {
    const win = makeWin();
    const { callbacks, pendingMcp, controller } = buildWithConfirm(win);
    const p = callbacks.confirmMcpCall!(PROMPT);
    controller.abort();
    await expect(p).resolves.toEqual({ allow: false, reason: 'cancelled' });
    expect(pendingMcp.size).toBe(0);
    expect(win.listenerCount('closed')).toBe(0);
  });

  it('an already-stopped turn never shows a card', async () => {
    const win = makeWin();
    const controller = new AbortController();
    controller.abort();
    const { callbacks, pendingMcp } = buildWithConfirm(win, controller);
    await expect(callbacks.confirmMcpCall!(PROMPT)).resolves.toEqual({ allow: false, reason: 'cancelled' });
    expect(pendingMcp.size).toBe(0);
    expect(win.webContents.send).not.toHaveBeenCalled();
  });

  it('closing the window resolves a pending card as no-ui', async () => {
    const win = makeWin();
    const { callbacks, pendingMcp } = buildWithConfirm(win);
    const p = callbacks.confirmMcpCall!(PROMPT);
    win.emit('closed');
    await expect(p).resolves.toEqual({ allow: false, reason: 'no-ui' });
    expect(pendingMcp.size).toBe(0);
  });

  it('a destroyed window is no-ui, with no card sent', async () => {
    const win = makeWin(true);
    const { callbacks, pendingMcp } = buildWithConfirm(win);
    await expect(callbacks.confirmMcpCall!(PROMPT)).resolves.toEqual({ allow: false, reason: 'no-ui' });
    expect(pendingMcp.size).toBe(0);
  });
});
