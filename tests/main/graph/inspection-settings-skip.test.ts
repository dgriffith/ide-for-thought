/**
 * @vitest-environment node
 *
 * A disabled check is SKIPPED, not run-and-filtered (#1792).
 *
 * Separate from the gating test on purpose. That one asserts on results, and
 * results alone can't tell the two apart: post-filtering ten completed checks
 * returns exactly the same list as never running them. (Confirmed — replacing
 * the guard with `() => true` left that suite entirely green.)
 *
 * It matters because several of these are whole-graph SPARQL queries, and the
 * reason to switch a check off is usually that you don't want to pay for it.
 * So this counts queries instead of findings, with the graph mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  queryGraph: vi.fn(async () => ({ results: [], columns: [] })),
  headingsFor: vi.fn(async () => [] as string[]),
}));

vi.mock('../../../src/main/graph/index', () => ({
  queryGraph: h.queryGraph,
  headingsFor: h.headingsFor,
}));

import {
  runAllChecks, startPeriodicChecks, stopPeriodicChecks, armAutoChecks, disarmAutoChecks,
} from '../../../src/main/graph/health-checks';
import { emitGraphChanged } from '../../../src/main/graph/graph-events';
import { onInspectionsChanged } from '../../../src/main/graph/inspection-events';
import { DEFAULT_INSPECTION_SETTINGS } from '../../../src/shared/inspections';
import { projectContext } from '../../../src/main/project-context-types';

const ctx = projectContext('/fake-project');

const ALL_VISIBLE = [
  'stale_note', 'broken_note_link', 'broken_anchor_link', 'broken_cite_quote',
  'source_missing_metadata', 'invalid_doi', 'source_duplicate_doi',
  'source_cited_unread', 'stub_aged',
];

beforeEach(() => { h.queryGraph.mockClear(); });

describe('runAllChecks — work avoided', () => {
  it('queries the graph when checks are on', async () => {
    await runAllChecks(ctx, DEFAULT_INSPECTION_SETTINGS);
    expect(h.queryGraph.mock.calls.length).toBeGreaterThan(5);
  });

  it('runs FEWER queries as checks are switched off', async () => {
    await runAllChecks(ctx, DEFAULT_INSPECTION_SETTINGS);
    const all = h.queryGraph.mock.calls.length;

    h.queryGraph.mockClear();
    await runAllChecks(ctx, { ...DEFAULT_INSPECTION_SETTINGS, disabled: ['stale_note'] });
    expect(h.queryGraph.mock.calls.length).toBeLessThan(all);
  });

  it('touches the graph not at all when every visible check is off', async () => {
    // The hidden argument-map checks are the exception — they always run, so
    // they're what's left. Assert against that number rather than zero, and
    // against the full-run number so the saving is real.
    await runAllChecks(ctx, DEFAULT_INSPECTION_SETTINGS);
    const all = h.queryGraph.mock.calls.length;

    h.queryGraph.mockClear();
    await runAllChecks(ctx, { ...DEFAULT_INSPECTION_SETTINGS, disabled: ALL_VISIBLE });
    const remaining = h.queryGraph.mock.calls.length;

    expect(remaining).toBeLessThan(all);
    // What's left is exactly the argument-map checks, which always run:
    // unsupported claims (1 query) + evidence gaps (2: warrants, backing) +
    // contradictions (1). Counted from the source rather than guessed — my
    // first attempt at this assertion said 3 and the code was right.
    expect(remaining).toBe(4);
  });
});

/**
 * The automatic runs honour the settings too (#1792 follow-up).
 *
 * The panel's Run button was wired to the settings, but the checks also run on
 * project open and every five minutes — and those callers passed nothing, so
 * they used the DEFAULTS and overwrote the cached results. Switching a check
 * off appeared to work, then the next automatic run quietly put it back. The
 * bug lived in the gap between "the toggle is wired" and "everything that runs
 * the checks is wired", which is exactly where nobody looks.
 */
describe('startPeriodicChecks', () => {
  it('runs on its timer with the settings it was given, not the defaults', async () => {
    vi.useFakeTimers();
    try {
      const loadSettings = vi.fn(async () => ({
        ...DEFAULT_INSPECTION_SETTINGS,
        disabled: ALL_VISIBLE,
      }));
      h.queryGraph.mockClear();

      startPeriodicChecks(ctx, { loadSettings, intervalMs: 1000 });
      await vi.advanceTimersByTimeAsync(1000);
      stopPeriodicChecks(ctx);

      expect(loadSettings).toHaveBeenCalled();
      // Only the always-on argument-map checks — the disabled ones were skipped.
      expect(h.queryGraph.mock.calls.length).toBe(4);
    } finally {
      vi.useRealTimers();
    }
  });

  it('re-reads the settings on EVERY tick, so a change takes effect without a restart', async () => {
    vi.useFakeTimers();
    try {
      const loadSettings = vi.fn(async () => ({ ...DEFAULT_INSPECTION_SETTINGS }));
      startPeriodicChecks(ctx, { loadSettings, intervalMs: 1000 });
      await vi.advanceTimersByTimeAsync(3000);
      stopPeriodicChecks(ctx);

      expect(loadSettings.mock.calls.length).toBe(3);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops when told to', async () => {
    vi.useFakeTimers();
    try {
      const loadSettings = vi.fn(async () => ({ ...DEFAULT_INSPECTION_SETTINGS }));
      startPeriodicChecks(ctx, { loadSettings, intervalMs: 1000 });
      stopPeriodicChecks(ctx);
      await vi.advanceTimersByTimeAsync(5000);

      expect(loadSettings).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

/**
 * Re-checking after a save (#1795).
 *
 * The five-minute timer meant you could break a link, save, and be told about
 * it several minutes later — long enough that the panel read as broken. Every
 * graph write now emits a change signal, and the checks re-run once the burst
 * settles.
 *
 * These drive the real subscription via `emitGraphChanged`, so a regression
 * that stops `indexNote` emitting, or stops `armAutoChecks` listening, fails
 * here.
 */
describe('armAutoChecks', () => {
  const ROOT = '/fake-project';

  it('re-runs a beat after a graph write', async () => {
    vi.useFakeTimers();
    try {
      const loadSettings = vi.fn(async () => ({ ...DEFAULT_INSPECTION_SETTINGS }));
      armAutoChecks(ctx, { loadSettings, debounceMs: 100 });
      h.queryGraph.mockClear();

      emitGraphChanged(ROOT);
      expect(h.queryGraph).not.toHaveBeenCalled(); // not instantly — debounced

      await vi.advanceTimersByTimeAsync(100);
      expect(h.queryGraph.mock.calls.length).toBeGreaterThan(0);
    } finally {
      disarmAutoChecks(ctx);
      vi.useRealTimers();
    }
  });

  it('collapses a burst into ONE run', async () => {
    // A bulk index emits once per note; a save emits a couple of times. Neither
    // should mean N whole-graph passes.
    vi.useFakeTimers();
    try {
      const loadSettings = vi.fn(async () => ({ ...DEFAULT_INSPECTION_SETTINGS }));
      armAutoChecks(ctx, { loadSettings, debounceMs: 100 });

      for (let i = 0; i < 20; i++) {
        emitGraphChanged(ROOT);
        await vi.advanceTimersByTimeAsync(10); // still inside the window
      }
      await vi.advanceTimersByTimeAsync(100);

      expect(loadSettings.mock.calls.length).toBe(1);
    } finally {
      disarmAutoChecks(ctx);
      vi.useRealTimers();
    }
  });

  it('ignores writes to a different thoughtbase', async () => {
    vi.useFakeTimers();
    try {
      const loadSettings = vi.fn(async () => ({ ...DEFAULT_INSPECTION_SETTINGS }));
      armAutoChecks(ctx, { loadSettings, debounceMs: 100 });

      emitGraphChanged('/some-other-project');
      await vi.advanceTimersByTimeAsync(500);

      expect(loadSettings).not.toHaveBeenCalled();
    } finally {
      disarmAutoChecks(ctx);
      vi.useRealTimers();
    }
  });

  it('honours the settings, so a disabled check stays disabled after a save', async () => {
    vi.useFakeTimers();
    try {
      const loadSettings = vi.fn(async () => ({
        ...DEFAULT_INSPECTION_SETTINGS,
        disabled: ALL_VISIBLE,
      }));
      armAutoChecks(ctx, { loadSettings, debounceMs: 100 });
      h.queryGraph.mockClear();

      emitGraphChanged(ROOT);
      await vi.advanceTimersByTimeAsync(100);

      expect(h.queryGraph.mock.calls.length).toBe(4); // the always-on ones only
    } finally {
      disarmAutoChecks(ctx);
      vi.useRealTimers();
    }
  });

  it('stops listening once disarmed', async () => {
    vi.useFakeTimers();
    try {
      const loadSettings = vi.fn(async () => ({ ...DEFAULT_INSPECTION_SETTINGS }));
      armAutoChecks(ctx, { loadSettings, debounceMs: 100 });
      disarmAutoChecks(ctx);

      emitGraphChanged(ROOT);
      await vi.advanceTimersByTimeAsync(500);

      expect(loadSettings).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it('announces the new results so a panel can refresh itself', async () => {
    vi.useFakeTimers();
    const seen: string[] = [];
    const off = onInspectionsChanged((root) => seen.push(root));
    try {
      const loadSettings = vi.fn(async () => ({ ...DEFAULT_INSPECTION_SETTINGS }));
      armAutoChecks(ctx, { loadSettings, debounceMs: 100 });

      emitGraphChanged(ROOT);
      await vi.advanceTimersByTimeAsync(100);

      expect(seen).toContain(ROOT);
    } finally {
      off();
      disarmAutoChecks(ctx);
      vi.useRealTimers();
    }
  });
});
