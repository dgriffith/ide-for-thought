import { describe, it, expect } from 'vitest';
import {
  toHistorySnapshot,
  canRestoreHistory,
  type HistorySnapshot,
} from '../../src/renderer/lib/editor/history-snapshot';

// The history snapshot guards the tab-switch undo/redo restore (#672). The
// drift check is the safety-critical part: never restore a stack whose doc no
// longer matches the buffer being mounted.

describe('toHistorySnapshot', () => {
  it('accepts an object with a string doc', () => {
    const snap = toHistorySnapshot({ doc: 'hello', history: { done: [] } });
    expect(snap).not.toBeNull();
    expect(snap!.doc).toBe('hello');
    // Opaque extra fields are preserved for EditorState.fromJSON.
    expect(snap!.history).toEqual({ done: [] });
  });

  it('rejects null / undefined / primitives', () => {
    expect(toHistorySnapshot(null)).toBeNull();
    expect(toHistorySnapshot(undefined)).toBeNull();
    expect(toHistorySnapshot('a string')).toBeNull();
    expect(toHistorySnapshot(42)).toBeNull();
  });

  it('rejects an object without a string doc', () => {
    expect(toHistorySnapshot({})).toBeNull();
    expect(toHistorySnapshot({ doc: 123 })).toBeNull();
    expect(toHistorySnapshot({ history: {} })).toBeNull();
  });
});

describe('canRestoreHistory', () => {
  const snap = (doc: string): HistorySnapshot => ({ doc });

  it('restores when the snapshot doc matches the content', () => {
    expect(canRestoreHistory(snap('same'), 'same')).toBe(true);
  });

  it('refuses when the doc has drifted (file reloaded / rewritten)', () => {
    expect(canRestoreHistory(snap('old'), 'new')).toBe(false);
  });

  it('refuses a null snapshot', () => {
    expect(canRestoreHistory(null, 'anything')).toBe(false);
  });

  it('treats the empty doc exactly (no falsy short-circuit)', () => {
    expect(canRestoreHistory(snap(''), '')).toBe(true);
    expect(canRestoreHistory(snap(''), 'x')).toBe(false);
  });
});
