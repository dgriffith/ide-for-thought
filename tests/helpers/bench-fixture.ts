/**
 * Fixture-reach assertions for `*.bench.ts` files (#2383).
 *
 * A benchmark is only as honest as its fixture. Twice the fixture could not
 * reach the code the bench was named after, and the numbers looked fine:
 *
 *   - #2211: the save-path benches seeded `note-${i}.md`, whose one-entry
 *     suffix index understated the real link-index cost by ~5x.
 *   - #2330: `health-checks.bench.ts` wrote notes with no backdated `modified`,
 *     so NOTHING passed the 30-day staleness filter and the single most
 *     expensive check in the sweep returned on its first query — for as long as
 *     the bench existed.
 *
 * Both were invisible for the same reason: a bench reports a time, and a time
 * cannot tell you what it measured. So every bench states, in its setup, what
 * its fixture must reach — a count via a test-only counter in the
 * `_derivationCountsForTests` style, or an observable effect (rows a query
 * returns, inspection types a sweep reports) — and fails the run when it
 * doesn't. `tests/architecture/bench-fixture-reach.test.ts` requires every
 * bench file to make at least one such assertion.
 *
 * Assert on what the FIXTURE reaches, not on how fast or how cleverly the code
 * handles it. "The query matched 50 notes" belongs here; "the second query did
 * not rebuild the mirror" is a performance property a regression is allowed to
 * break, and the gate should report it as a number, not as a setup crash.
 *
 * Setup runs as a top-level `await` (see `n3-cold-rebuild.bench.ts`'s header),
 * so a throw here fails the bench FILE — `pnpm bench` exits non-zero, which the
 * `bench:check` chain turns into a red gate, which the scheduled workflow turns
 * into an issue (#2242).
 */

export class BenchFixtureError extends Error {
  override name = 'BenchFixtureError';
}

/**
 * Throw unless `holds`. `claim` reads as what the fixture is supposed to reach
 * ("every seeded note is indexed"); `observed` is what was actually seen, and
 * goes in the message so the failure says how far off the fixture is.
 */
export function assertFixtureReaches(claim: string, holds: boolean, observed?: unknown): asserts holds {
  if (holds) return;
  const seen = observed === undefined ? '' : ` (observed: ${JSON.stringify(observed)})`;
  throw new BenchFixtureError(
    `bench fixture does not reach the path under test: ${claim}${seen}. `
    + 'The bench would time something other than what its name says — fix the fixture, '
    + 'not this assertion (#2383).',
  );
}
