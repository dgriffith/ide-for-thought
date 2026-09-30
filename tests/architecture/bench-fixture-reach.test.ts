/**
 * @vitest-environment node
 *
 * Every `*.bench.ts` asserts, in its setup, that its fixture reaches the code
 * path the bench is named after (#2383).
 *
 * Bench fixtures mis-measured twice, silently: #2211's `note-${i}.md` seeding
 * understated the save path's link-index cost by ~5x, and #2330 found that
 * `health-checks.bench.ts` had never reached the staleness check at all — its
 * notes were written milliseconds before the sweep, so nothing passed the
 * 30-day filter and the most expensive check returned on its first query. A
 * bench reports a time, and a time cannot say what it measured; only the
 * fixture can, and only if it is made to.
 *
 * So each bench calls `assertFixtureReaches` (tests/helpers/bench-fixture.ts)
 * at least once — a count from a test-only counter, or an observable effect of
 * the fixture. This test checks the call exists; it deliberately does not try
 * to judge whether the assertion is a GOOD one, which no static check can do
 * without becoming a second copy of each bench. The point is that a new bench
 * cannot be written without its author having to state what it reaches.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { assertFixtureReaches, BenchFixtureError } from '../helpers/bench-fixture';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

function benchFiles(dir = path.join(ROOT, 'tests')): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...benchFiles(abs));
    else if (entry.name.endsWith('.bench.ts')) out.push(path.relative(ROOT, abs).split(path.sep).join('/'));
  }
  return out.sort();
}

/** Calls, not the import line: `assertFixtureReaches(` preceded by something
 *  other than `import {` on the same statement. */
function assertionCalls(source: string): number {
  return [...source.matchAll(/(^|[^\w.])assertFixtureReaches\s*\(/gm)].length;
}

describe('bench fixtures assert they reach the path under test (#2383)', () => {
  const files = benchFiles();

  it('finds the bench suite (an empty walk would pass vacuously)', () => {
    expect(files.length).toBeGreaterThanOrEqual(8);
  });

  it('every *.bench.ts calls assertFixtureReaches in its setup', () => {
    const missing = files.filter((f) => assertionCalls(fs.readFileSync(path.join(ROOT, f), 'utf8')) === 0);
    expect(
      missing,
      'Bench file(s) with no fixture-reach assertion:\n\n' +
        missing.map((f) => `  ${f}`).join('\n') +
        '\n\nAfter seeding, assert what the fixture must reach with assertFixtureReaches ' +
        '(tests/helpers/bench-fixture.ts): a count from a `_…ForTests` counter, rows a query ' +
        'returns, inspection types a sweep reports. #2211 and #2330 are what an unchecked ' +
        'fixture looks like — a plausible number measuring the wrong thing.',
    ).toEqual([]);
  });

  it('the matcher counts calls, not the import', () => {
    expect(assertionCalls("import { assertFixtureReaches } from '../../helpers/bench-fixture';\n")).toBe(0);
    expect(assertionCalls('  assertFixtureReaches(`x`, true);\n')).toBe(1);
  });

  it('the helper throws a BenchFixtureError naming the claim and what was observed', () => {
    expect(() => assertFixtureReaches('the query matches 50 notes', true, 50)).not.toThrow();
    expect(() => assertFixtureReaches('the query matches 50 notes', false, 0))
      .toThrow(BenchFixtureError);
    expect(() => assertFixtureReaches('the query matches 50 notes', false, 0))
      .toThrow(/the query matches 50 notes \(observed: 0\)/);
  });
});
