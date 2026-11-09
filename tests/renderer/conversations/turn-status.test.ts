/**
 * The turn-status line's pure parts: elapsed formatting and verb rotation.
 */
import { describe, it, expect } from 'vitest';
import { TURN_VERBS, VERB_ROTATE_MS, formatElapsed, verbAt, verbOffsetFor, waitingText } from '../../../src/renderer/lib/conversations/turn-status';

describe('formatElapsed', () => {
  it('reads naturally at every scale', () => {
    expect(formatElapsed(0)).toBe('0s');
    expect(formatElapsed(4_900)).toBe('4s');
    expect(formatElapsed(59_999)).toBe('59s');
    expect(formatElapsed(65_000)).toBe('1m 05s');
    expect(formatElapsed(12 * 60_000 + 40_000)).toBe('12m 40s');
    expect(formatElapsed(62 * 60_000)).toBe('1h 02m');
  });
  it('never goes negative (a clock that stepped backwards)', () => {
    expect(formatElapsed(-3_000)).toBe('0s');
  });
});

describe('verb rotation', () => {
  it('holds a verb for its interval, then moves on, wrapping round the list', () => {
    expect(verbAt(0, 0)).toBe(TURN_VERBS[0]);
    expect(verbAt(VERB_ROTATE_MS - 1, 0)).toBe(TURN_VERBS[0]);
    expect(verbAt(VERB_ROTATE_MS, 0)).toBe(TURN_VERBS[1]);
    expect(verbAt(VERB_ROTATE_MS * TURN_VERBS.length, 0)).toBe(TURN_VERBS[0]);
  });
  it('starts each turn somewhere stable but different', () => {
    const a = verbOffsetFor(1_790_000_000_000);
    expect(verbOffsetFor(1_790_000_000_000)).toBe(a); // same turn, same start
    const starts = new Set(Array.from({ length: 20 }, (_, i) => verbOffsetFor(1_790_000_000_000 + i * 1000)));
    expect(starts.size).toBeGreaterThan(1);
  });
});

describe('waitingText (#2969)', () => {
  it('a queued turn says it is waiting for a slot, and how many are ahead', () => {
    expect(waitingText({ kind: 'queued', ahead: 0 }, 0)).toBe('Waiting for a slot…');
    expect(waitingText({ kind: 'queued', ahead: 2 }, 0)).toBe('Waiting for a slot (2 ahead)…');
  });

  it('a rate-limited turn counts down to its retry', () => {
    const s = { kind: 'rate-limited' as const, retryInMs: 5_000, attempt: 1 };
    expect(waitingText(s, 0)).toBe('Rate limited — retrying in 5s…');
    expect(waitingText(s, 3_200)).toBe('Rate limited — retrying in 2s…');
    expect(waitingText(s, 6_000)).toBe('Rate limited — retrying…');
  });
});
