/**
 * Debounced search-index persistence (perf #1107).
 *
 * `persist` serializes the whole MiniSearch index — O(total corpus bytes),
 * not O(the one changed note) — so the per-save write path now calls
 * `schedulePersist` (a debounced, coalescing wrapper) instead of `persist`
 * directly. These tests pin that contract: no immediate write, one write
 * after the quiet period, repeated calls coalesce to a single write, and an
 * explicit `persist()` still forces an immediate write (the release/quit
 * paths keep calling that).
 *
 * Uses `_setPersistDebounceMsForTests` to shrink the real debounce window,
 * plus vitest fake timers to make the "hasn't fired yet" assertions
 * deterministic (issue #1943) — a real `sleep(DEBOUNCE_MS / 2)` races the
 * runner's actual clock, so an overshoot on a loaded CI box lets the
 * debounced write land early and turns a "hasn't written yet" assertion red.
 * `vi.advanceTimersByTimeAsync` fires the timer at an exact fake-clock
 * offset with no such race. Once a test needs to cross the deadline and
 * confirm the write actually landed, it switches to real timers first —
 * `schedulePersist`'s callback does real `fs` I/O that completes via the
 * real event loop regardless of timer mode, but relying on fake-timer
 * microtask draining to observe that completion is itself timing-sensitive
 * (the exact number of promise hops isn't fixed), so `waitForWrite` polls on
 * the real clock instead.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  initSearch,
  indexNote,
  persist,
  schedulePersist,
  disposeProject,
  _setPersistDebounceMsForTests,
} from '../../../src/main/search/index';
import { projectContext, type ProjectContext } from '../../../src/main/project-context-types';

const DEBOUNCE_MS = 200;

function indexFilePath(root: string): string {
  return path.join(root, '.minerva', 'search-index.json');
}

/** Poll on the REAL clock for the debounced write to land. Call only after
 *  `vi.useRealTimers()` — the fake clock never advances on its own. */
async function waitForWrite(root: string, timeoutMs = 2000): Promise<string> {
  const p = indexFilePath(root);
  const start = Date.now();
  for (;;) {
    try {
      const raw = fs.readFileSync(p, 'utf-8');
      if (raw) return raw;
    } catch {
      // Not written yet, or caught mid-write — keep polling.
    }
    if (Date.now() - start > timeoutMs) throw new Error(`search index not written within ${timeoutMs}ms`);
    await new Promise((resolve) => { setTimeout(resolve, 5); });
  }
}

describe('search index persistence (perf #1107)', () => {
  let root: string;
  let ctx: ProjectContext;

  beforeEach(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-search-persist-'));
    fs.mkdirSync(path.join(root, '.minerva'), { recursive: true });
    ctx = projectContext(root);
    await initSearch(ctx);
    _setPersistDebounceMsForTests(DEBOUNCE_MS);
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    _setPersistDebounceMsForTests(3000);
    disposeProject(ctx);
    fs.rmSync(root, { recursive: true, force: true });
  });

  it('schedulePersist does not write immediately', () => {
    indexNote(ctx, 'a.md', '# A\nbody');
    schedulePersist(ctx);
    expect(fs.existsSync(indexFilePath(root))).toBe(false);
  });

  it('schedulePersist writes after the debounce delay elapses', async () => {
    indexNote(ctx, 'a.md', '# A\nbody');
    schedulePersist(ctx);

    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS - 1);
    expect(fs.existsSync(indexFilePath(root))).toBe(false);

    // Cross the deadline to invoke the callback (kicks off the real fs
    // write), then hand off to the real event loop so it can complete.
    await vi.advanceTimersByTimeAsync(1);
    vi.useRealTimers();
    const written = await waitForWrite(root);
    expect(written).toContain('a.md');
  });

  it('repeated schedulePersist calls within the window coalesce into one write', async () => {
    indexNote(ctx, 'a.md', '# A\nbody');
    schedulePersist(ctx);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS / 2);
    // A second save comes in before the first would have fired — this
    // resets the timer to fire DEBOUNCE_MS from THIS call, not from the
    // first, so the first would-have-fired deadline must pass with nothing
    // written yet.
    indexNote(ctx, 'b.md', '# B\nbody');
    schedulePersist(ctx);
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS / 2 - 1);
    expect(fs.existsSync(indexFilePath(root))).toBe(false);

    // The re-armed timer's deadline is DEBOUNCE_MS after the SECOND call.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS / 2 + 1);
    vi.useRealTimers();
    const written = await waitForWrite(root);
    // Both notes made it into the single, coalesced write.
    expect(written).toContain('a.md');
    expect(written).toContain('b.md');
  });

  it('persist() forces an immediate write and cancels a pending scheduled one', async () => {
    indexNote(ctx, 'a.md', '# A\nbody');
    schedulePersist(ctx);
    expect(fs.existsSync(indexFilePath(root))).toBe(false);

    await persist(ctx);
    expect(fs.existsSync(indexFilePath(root))).toBe(true);
    const firstWrite = fs.statSync(indexFilePath(root)).mtimeMs;

    // The debounced timer that was pending before persist() ran should have
    // been cancelled — advancing past its original deadline must not fire a
    // second, redundant write.
    await vi.advanceTimersByTimeAsync(DEBOUNCE_MS * 2);
    expect(fs.statSync(indexFilePath(root)).mtimeMs).toBe(firstWrite);
  });
});
