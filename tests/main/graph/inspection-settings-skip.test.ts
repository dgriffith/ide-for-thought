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

import { runAllChecks, startPeriodicChecks, stopPeriodicChecks } from '../../../src/main/graph/health-checks';
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
