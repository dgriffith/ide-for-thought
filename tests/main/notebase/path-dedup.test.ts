/**
 * Tests for the IPC↔watcher dedup window (#345).
 *
 * The dedup logic used to live as a closure inside `openProjectInWindow`
 * and a module-scoped Map in `window-manager.ts`, neither testable in
 * isolation. It now lives in `notebase/path-dedup.ts`; these tests pin
 * the 2s-window contract that the watcher relies on to avoid double
 * indexing IPC-originated writes.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  markPathHandled,
  wasHandled,
  _resetForTests,
} from '../../../src/main/notebase/path-dedup';

describe('path-dedup (#345)', () => {
  beforeEach(() => {
    _resetForTests();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-04-25T12:00:00Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('an unmarked path is never considered handled', () => {
    expect(wasHandled('notes/x.md')).toBe(false);
  });

  it('immediately after markPathHandled, the path is handled', () => {
    markPathHandled('notes/x.md');
    expect(wasHandled('notes/x.md')).toBe(true);
  });

  it('marks are scoped to the exact path string (no prefix matching)', () => {
    markPathHandled('notes/x.md');
    expect(wasHandled('notes/y.md')).toBe(false);
    expect(wasHandled('notes/x')).toBe(false);
    expect(wasHandled('x.md')).toBe(false);
  });

  it('a mark stays valid for the full 2s window', () => {
    markPathHandled('notes/x.md');
    vi.advanceTimersByTime(1999);
    expect(wasHandled('notes/x.md')).toBe(true);
  });

  it('a mark expires after 2s (>2000ms is stale)', () => {
    markPathHandled('notes/x.md');
    vi.advanceTimersByTime(2001);
    expect(wasHandled('notes/x.md')).toBe(false);
  });

  it('reading an expired mark evicts it (the map cannot grow unbounded)', () => {
    markPathHandled('notes/x.md');
    vi.advanceTimersByTime(2001);
    // First read returns false AND drops the entry. A second read on the
    // same path must still return false — i.e. the entry's truly gone, not
    // just temporarily masked.
    expect(wasHandled('notes/x.md')).toBe(false);
    // Any later mark on a different path doesn't resurrect the first one.
    markPathHandled('notes/y.md');
    expect(wasHandled('notes/x.md')).toBe(false);
  });

  it('re-marking a path refreshes its window', () => {
    markPathHandled('notes/x.md');
    vi.advanceTimersByTime(1500);
    markPathHandled('notes/x.md'); // re-stamp
    vi.advanceTimersByTime(1500);  // 3000ms since first mark, 1500ms since re-stamp
    expect(wasHandled('notes/x.md')).toBe(true);
  });

  it('different paths track independent windows', () => {
    markPathHandled('notes/a.md');
    vi.advanceTimersByTime(1000);
    markPathHandled('notes/b.md');
    vi.advanceTimersByTime(1500); // a is now 2500ms old, b is 1500ms old
    expect(wasHandled('notes/a.md')).toBe(false); // expired
    expect(wasHandled('notes/b.md')).toBe(true);  // still fresh
  });
});
