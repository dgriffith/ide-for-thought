/**
 * @vitest-environment node
 *
 * Every `gate: false` entry in the bench baseline links the issue that owns
 * arming it (#2358).
 *
 * `gate: false` is the one state in `tests/main/bench-baseline.json` that fails
 * nothing when it is forgotten. #2211 added six ungated entries with a sentence
 * in `_comment` — "turn gating on in the PR that fixes each" — and when those
 * fixes landed nobody armed them, because a sentence in a comment has no one to
 * remind. Meanwhile the scheduled gate stayed red on stale state for four
 * Mondays, which trains the reader of #2242's notification path to ignore it.
 *
 * So an ungated entry carries a structured `issue` number and a `reason`. This
 * test checks that offline, inside `pnpm test`. Whether the issue is still OPEN
 * needs the network, so `bench.yml` checks that half on every gate run
 * (`scripts/check-bench-ungated.mjs`), and a closed link fails the run into the
 * existing failure-notify step.
 *
 * After #2331 armed the six, there may be no ungated entries at all — so the
 * rule is also exercised against injected fixtures, or it would pass vacuously
 * and nobody would know whether it still bites.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findClosedLinks,
  findUntrackedUngated,
  ungatedEntries,
  type Baseline,
} from '../../scripts/lib/bench-ungated.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const BASELINE = path.join(ROOT, 'tests', 'main', 'bench-baseline.json');

describe('ungated bench entries link an owning issue (#2358)', () => {
  const committed = JSON.parse(fs.readFileSync(BASELINE, 'utf-8')) as Baseline;

  it('reads the committed baseline (a broken read would pass vacuously)', () => {
    expect(committed.benchmarks?.length ?? 0).toBeGreaterThan(10);
  });

  it('every gate:false entry in tests/main/bench-baseline.json has an issue and a reason', () => {
    const problems = findUntrackedUngated(committed);
    expect(
      problems,
      'Ungated bench entries with no owner:\n\n' +
        problems.map((p) => `  ${p.name}: ${p.problem}`).join('\n') +
        '\n\nAdd `"issue": <number>, "reason": "<why>"` to each — the issue that will arm it. ' +
        'An ungated bench with no owner is a gate nobody will ever turn back on. ' +
        'bench.yml additionally fails if the linked issue is closed.',
    ).toEqual([]);
  });

  it('flags an injected ungated entry with no link, and one with no reason', () => {
    const fixture: Baseline = {
      benchmarks: [
        { name: 'gated op', mean: 1 },
        { name: 'explicitly gated op', mean: 1, gate: true },
        { name: 'orphan op', mean: 1, gate: false },
        { name: 'unexplained op', mean: 1, gate: false, issue: 4242 },
        { name: 'bad link op', mean: 1, gate: false, issue: '#4242', reason: 'slow' },
        { name: 'owned op', mean: 1, gate: false, issue: 4242, reason: 'known-slow until #4242 lands' },
      ],
    };
    expect(ungatedEntries(fixture).map((b) => b.name)).toEqual([
      'orphan op',
      'unexplained op',
      'bad link op',
      'owned op',
    ]);
    const problems = findUntrackedUngated(fixture);
    expect(problems.map((p) => p.name)).toEqual(['orphan op', 'unexplained op', 'bad link op']);
    expect(problems[0]!.problem).toMatch(/issue.*reason/);
    expect(problems[1]!.problem).toMatch(/reason/);
    expect(problems[1]!.problem).not.toMatch(/issue/);
    expect(problems[2]!.problem).toMatch(/issue/);
  });

  it('the online half fails a CLOSED link and passes an OPEN one, asking once per issue', () => {
    const fixture: Baseline = {
      benchmarks: [
        { name: 'a', gate: false, issue: 10, reason: 'r' },
        { name: 'b', gate: false, issue: 10, reason: 'r' },
        { name: 'c', gate: false, issue: 11, reason: 'r' },
        { name: 'gated', issue: 12 },
      ],
    };
    const asked: number[] = [];
    const closed = findClosedLinks(fixture, (n) => {
      asked.push(n);
      return n === 11 ? 'CLOSED' : 'OPEN';
    });
    expect(closed).toEqual([{ name: 'c', issue: 11, state: 'CLOSED' }]);
    expect(asked).toEqual([10, 11]);
  });

  it('bench.yml runs the open-issue check with a token on the gate path', () => {
    const raw = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'bench.yml'), 'utf-8');
    expect(raw).toContain('node scripts/check-bench-ungated.mjs');
    expect(raw).toMatch(/GH_TOKEN:\s*\$\{\{\s*github\.token\s*\}\}/);
  });
});
