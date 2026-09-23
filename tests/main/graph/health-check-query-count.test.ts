/**
 * @vitest-environment node
 *
 * How many SPARQL round-trips one post-save sweep costs (#2208 C1b).
 *
 * `runAllChecks` fires on a 2-second debounce after every graph write, on the
 * Electron main thread, where Comunica's evaluation is synchronous JS — so
 * `Promise.all` buys nothing and every query in the sweep is latency the user's
 * next keystroke waits behind. The issue counted seventeen. Five of them were
 * five source checks each re-walking `?source minerva:sourceId ?sourceId` to
 * pull one more property off it, which is now one shared scan
 * (`source-checks.ts`).
 *
 * A count is the right gate here rather than a stopwatch (#2229): it is
 * deterministic, it fails on a laptop the same way it fails on CI, and the
 * thing being defended — "don't add a sixth whole-graph walk over the source
 * table" — is a count.
 *
 * **A count gate alone is worthless**, and this file is not one: "N saves, one
 * query" is satisfied perfectly by zero queries and an empty panel. Its
 * necessary other half is `health-check-findings.test.ts`, which states the
 * findings a fixture project must produce. Neither test is complete without
 * the other; if you change one, read the other.
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

import { runAllChecks, armAutoChecks, disarmAutoChecks } from '../../../src/main/graph/health-checks';
import { emitGraphChanged } from '../../../src/main/graph/graph-events';
import { DEFAULT_INSPECTION_SETTINGS } from '../../../src/shared/inspections';
import { projectContext } from '../../../src/main/project-context-types';

const ROOT = '/fake-count-project';
const ctx = projectContext(ROOT);

/**
 * The full sweep, on an EMPTY graph — every query returns no rows, so the
 * staleness detail fetch (which only runs when phase one found something) is
 * skipped and this is the floor, not the ceiling.
 *
 * Counted from the source rather than guessed:
 *   unsupported claims 1 + evidence gaps 2 + contradictions 1   = 4  (always on)
 *   staleness phase one                                          = 1
 *   source facts (shared by all five source checks)              = 1
 *   citation counts (source_cited_unread)                        = 1
 *   broken links: notes + sources + excerpts + the link walk     = 4
 *                                                                 ---
 *                                                                  11
 *
 * It was 16 before the source scan was shared — and 17 on any thoughtbase with
 * a stale note in it, which is every thoughtbase older than a month.
 */
const FULL_SWEEP_QUERIES = 11;

beforeEach(() => { h.queryGraph.mockClear(); });

describe('runAllChecks — round-trips per sweep (#2208)', () => {
  it('issues eleven queries with every check on, not seventeen', async () => {
    await runAllChecks(ctx, DEFAULT_INSPECTION_SETTINGS);
    expect(h.queryGraph.mock.calls.length).toBe(FULL_SWEEP_QUERIES);
  });

  it('spends TWO queries on the five source checks, not six', async () => {
    // The consolidation, stated as the number it is about. Disable everything
    // that isn't a source check and count what is left beyond the four
    // always-on argument-map queries.
    await runAllChecks(ctx, {
      ...DEFAULT_INSPECTION_SETTINGS,
      disabled: ['stale_note', 'unreferenced_image', 'broken_note_link', 'broken_anchor_link', 'broken_cite_quote'],
    });
    expect(h.queryGraph.mock.calls.length).toBe(4 + 2);
  });

  it('asks the source table nothing when all five source checks are off', async () => {
    // The shared scan must be a skip, not a filter (#1792): a user who turned
    // these off should not pay for a walk whose results are then discarded.
    await runAllChecks(ctx, {
      ...DEFAULT_INSPECTION_SETTINGS,
      disabled: [
        'invalid_doi', 'source_missing_metadata', 'stub_aged',
        'source_cited_unread', 'source_duplicate_doi',
        'stale_note', 'unreferenced_image',
        'broken_note_link', 'broken_anchor_link', 'broken_cite_quote',
      ],
    });
    expect(h.queryGraph.mock.calls.length).toBe(4);
  });

  it('drops to one source query when only the citation-count check is off', async () => {
    // The citation count is the one part of the source work that is NOT shared
    // — it joins from the note side — so it keeps its own switch.
    await runAllChecks(ctx, {
      ...DEFAULT_INSPECTION_SETTINGS,
      disabled: [
        'source_cited_unread',
        'stale_note', 'unreferenced_image',
        'broken_note_link', 'broken_anchor_link', 'broken_cite_quote',
      ],
    });
    expect(h.queryGraph.mock.calls.length).toBe(4 + 1);
  });

  it('costs one sweep, not one per write, across a burst of saves', async () => {
    vi.useFakeTimers();
    try {
      const loadSettings = vi.fn(async () => ({ ...DEFAULT_INSPECTION_SETTINGS }));
      armAutoChecks(ctx, { loadSettings, debounceMs: 100 });
      h.queryGraph.mockClear();

      for (let i = 0; i < 20; i++) {
        emitGraphChanged(ROOT);
        await vi.advanceTimersByTimeAsync(10); // still inside the debounce window
      }
      await vi.advanceTimersByTimeAsync(100);

      // Exactly one sweep's worth — and the assertion is the EXACT number, so
      // it fails for "the burst ran twice" and for "the sweep stopped asking
      // anything" alike. The second failure mode is the one a
      // `toBeLessThan(17)` gate would sail straight past.
      expect(h.queryGraph.mock.calls.length).toBe(FULL_SWEEP_QUERIES);
    } finally {
      disarmAutoChecks(ctx);
      vi.useRealTimers();
    }
  });
});
