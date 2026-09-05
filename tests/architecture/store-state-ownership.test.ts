/**
 * @vitest-environment node
 *
 * Zero-state passthrough stores (#2051, epic #1855).
 *
 * `store-ownership.test.ts` (#1852) checks that every mutating `api.*` domain
 * has SOME file under `stores/` or `lib/app/` calling it — but it says so
 * itself: "It CANNOT tell a well-designed store from a one-line passthrough."
 * Two real stores proved the gap wasn't hypothetical: `publish.svelte.ts` and
 * `review.svelte.ts` are pure `api.*` forwards with zero owned `$state`/
 * `$derived` — their own doc comments say "Thin passthroughs" — yet they
 * satisfy #1852 completely, because CLAUDE.md's data-flow rule only requires
 * that a mutation route through a store, not that the store own the
 * resulting reactive state.
 *
 * This test doesn't ban the shape — a pure passthrough is a legitimate
 * design when the calling component already does its own read-refresh, which
 * is exactly what every store below relies on today. It names the shape
 * instead, same budget-not-verdict style as `pattern-ratchets.test.ts`: "has
 * an owner" (#1852) and "owns something" (here) become two separately
 * checkable claims, and a new zero-state store has to be argued for in a
 * diff rather than accumulate silently.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { apiCallsIn, filesUnder, stripComments } from '../helpers/renderer-api-surface';

const STORES_DIR = 'src/renderer/lib/stores';

/**
 * Stores that call at least one `api.*` method but call neither `$state` nor
 * `$derived` anywhere in the file — i.e. own no reactive state of their own.
 * Each entry says why today's passthrough is fine; that's the rationale a
 * reviewer should re-check before a seventh one lands.
 *
 * A budget, not an approval list. The count may go DOWN (a passthrough grows
 * real owned state, or a caller's read-refresh dance gets folded into the
 * store) but not up without a reason argued for in the diff.
 */
const ZERO_STATE_STORE_BASELINE: Record<string, string> = {
  [`${STORES_DIR}/link-suggestions.svelte.ts`]:
    'Single-method forward to api.refactor.applySuggestedLink; callers refetch on the NOTEBASE_REWRITTEN broadcast rather than reading anything back here.',
  [`${STORES_DIR}/publish.svelte.ts`]:
    'Export/git-publish/target actions; ExportDialog and PublishDialog keep their own view state and read exporter/target metadata directly.',
  [`${STORES_DIR}/review.svelte.ts`]:
    'Approve/reject/run-inspections; the right-sidebar review panels do their own read-refresh after each call.',
  [`${STORES_DIR}/saved-queries.svelte.ts`]:
    "Rename/delete/move/setGroup/setOrder; the Edit Saved Queries dialog keeps its own list state and re-reads via api.queries.list().",
  [`${STORES_DIR}/settings.svelte.ts`]:
    'Config writes across a dozen settings domains; every settings dialog reads its own config directly and this only fronts the write.',
  [`${STORES_DIR}/source-data.svelte.ts`]:
    'Source/collection mutations plus change subscriptions; each consuming panel owns its own view state and refreshes on the events this store forwards.',
};

/** Whether `src` calls `$state` or `$derived` anywhere outside comments. */
function ownsReactiveState(src: string): boolean {
  return /\$state\b|\$derived\b/.test(stripComments(src));
}

const storeFiles = filesUnder(STORES_DIR, '.svelte.ts').sort();

describe('zero-state passthrough stores (#2051)', () => {
  it('parses a non-trivial surface — a broken scan would pass vacuously', () => {
    expect(storeFiles.length, 'no store files found').toBeGreaterThan(15);
    expect(
      storeFiles.filter((f) => apiCallsIn([f]).size > 0).length,
      'no store calls any api.* method',
    ).toBeGreaterThan(10);
  });

  it('names every store that forwards api.* calls without owning reactive state', () => {
    const zeroState = storeFiles
      .filter((f) => apiCallsIn([f]).size > 0)
      .filter((f) => !ownsReactiveState(readFileSync(f, 'utf8')));

    const unlisted = zeroState.filter((f) => !(f in ZERO_STATE_STORE_BASELINE)).sort();
    expect(
      unlisted,
      'Store(s) that call api.* but own no $state/$derived of their own.\n\n' +
        `${unlisted.join('\n')}\n\n` +
        'CLAUDE.md\'s renderer data-flow rule says the store method "owns the api call and updates ' +
        'observable state" — a pure forward satisfies the routing half but not the ownership half. ' +
        "That's fine when the calling component already owns its own read-refresh (as every existing " +
        'entry does), but say so: add it to ZERO_STATE_STORE_BASELINE in this test with a reason, the ' +
        'same way pattern-ratchets.test.ts budgets known-bad shapes.',
    ).toEqual([]);
  });

  it('keeps the baseline live (no stale entries)', () => {
    const stale = Object.keys(ZERO_STATE_STORE_BASELINE).filter((f) => {
      if (!storeFiles.includes(f)) return true;
      const stillZeroState = apiCallsIn([f]).size > 0 && !ownsReactiveState(readFileSync(f, 'utf8'));
      return !stillZeroState;
    });
    expect(
      stale,
      'ZERO_STATE_STORE_BASELINE entries that are no longer zero-state passthroughs (file gone, no ' +
        `longer calls api.*, or now owns $state/$derived) — nice, remove them: ${stale.join(', ')}`,
    ).toEqual([]);
  });
});
