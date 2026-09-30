/**
 * The weekly quality dashboard's pure half (#2389).
 *
 * `scripts/quality-dashboard.mjs` does the I/O (`gh api`, `git`, Codecov);
 * everything that decides what a number MEANS lives in
 * `scripts/lib/quality-dashboard.mjs` and is pinned here — in particular that
 * the ratchet totals are read from the tests that enforce them (so a renamed
 * baseline fails here instead of quietly reading 0), and that an unavailable
 * source renders as unavailable, never as zeros.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  BENCH_ISSUE_TITLE,
  DASHBOARD_LABEL,
  DASHBOARD_TITLE,
  RATCHETS,
  bucketOf,
  collectErrors,
  findDashboardIssue,
  fmtDuration,
  isFixCommit,
  literalEntries,
  measureRatchet,
  parseFixCommits,
  parseFlakeSummary,
  quantile,
  renderDashboard,
  runDistribution,
  stepDurations,
  stripComments,
  weekBuckets,
  weeklyDurations,
  weeklyFlakes,
} from '../../scripts/lib/quality-dashboard.mjs';
import { formatReport } from '../../scripts/lib/e2e-flake-budget.mjs';

const ROOT = path.resolve(__dirname, '../..');
const NOW = new Date('2026-09-30T12:00:00Z');

describe('literalEntries — reading a baseline constant out of TS source', () => {
  it('counts the entries of a Record literal, ignoring comments and annotations', () => {
    const src = `
      // const FOO = { 'decoy': 1 };
      const FOO: Readonly<Record<string, number>> = {
        // a comment with a comma, and an 'apostrophe': 9
        'a/b.ts': 1,
        'c/d.ts': 2,  // trailing comment
        /* block, comment */ 'e.ts': 3,
      };
      const NEXT = [1, 2];`;
    expect(literalEntries(src, 'FOO')).toEqual(["'a/b.ts': 1", "'c/d.ts': 2", "'e.ts': 3"]);
  });

  it('reads arrays and new Set([...])', () => {
    expect(literalEntries(`const A: readonly string[] = ['x', 'y'];`, 'A')).toHaveLength(2);
    expect(literalEntries(`const A: readonly string[] = [];`, 'A')).toHaveLength(0);
    expect(literalEntries(`const S = new Set<string>([\n  'a <-> b',\n  // 'c <-> d',\n  'e <-> f',\n]);`, 'S'))
      .toEqual(["'a <-> b'", "'e <-> f'"]);
  });

  it('keeps nested values and string contents intact', () => {
    const src = `const R = { 'k': 'has, a comma and a } brace', 'j': { x: [1, 2] } };`;
    expect(literalEntries(src, 'R')).toEqual(["'k': 'has, a comma and a } brace'", "'j': { x: [1, 2] }"]);
  });

  it('is not confused by a quote in a regex literal before the declaration', () => {
    const src = `const RE = /'/g;\nconst B = { 'a': 1, 'b': 2 };`;
    expect(literalEntries(src, 'B')).toHaveLength(2);
  });

  it('throws when the constant is missing or not a literal — a rename must fail loudly', () => {
    expect(() => literalEntries(`const OTHER = {};`, 'FOO')).toThrow(/not found/);
    expect(() => literalEntries(`const FOO = build();`, 'FOO')).toThrow(/not initialised/);
  });

  it('stripComments leaves strings that contain comment markers alone', () => {
    expect(stripComments(`'http://x' // gone`)).toBe(`'http://x' \n`);
    expect(stripComments(`a /* x */ b`)).toBe('a  b');
  });
});

describe('measureRatchet', () => {
  it('record-sum sums the values and counts the files', () => {
    const r = { label: 'x', file: 'f', name: 'B', kind: 'record-sum' };
    expect(measureRatchet(r, `const B: Record<string, number> = { 'a': 1, 'b': 3 };`)).toEqual({ value: 4, detail: '2 files' });
    expect(() => measureRatchet(r, `const B = { 'a': 'why' };`)).toThrow(/not `'key': <number>`/);
  });

  it('json-array counts the array', () => {
    const r = { label: 'x', file: 'f.json', key: 'advisories', kind: 'json-array' };
    expect(measureRatchet(r, JSON.stringify({ advisories: [{}, {}] })).value).toBe(2);
    expect(() => measureRatchet(r, '{}')).toThrow(/not an array/);
  });

  it.each(RATCHETS.map((r) => [r.label, r] as const))(
    'reads %s from its real source of truth',
    (_label, r) => {
      // The dashboard is only as honest as this: if the constant is renamed,
      // moved or reshaped, this fails in `pnpm test` rather than the dashboard
      // reporting a confident wrong number.
      const src = fs.readFileSync(path.join(ROOT, r.file), 'utf-8');
      const { value } = measureRatchet(r, src);
      expect(Number.isInteger(value)).toBe(true);
      expect(value).toBeGreaterThanOrEqual(0);
    },
  );

  it('covers the ratchets #2389 names: swallows, KNOWN_UNREGISTERED, package cycles', () => {
    const names = RATCHETS.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining(['SWALLOW_BASELINE', 'SWALLOW_EXPR_BASELINE', 'KNOWN_UNREGISTERED', 'KNOWN_PACKAGE_CYCLES']));
  });

  it('every ratchet test it reads is inventoried in docs/architecture-ratchets.md', () => {
    const doc = fs.readFileSync(path.join(ROOT, 'docs/architecture-ratchets.md'), 'utf-8');
    for (const r of RATCHETS.filter((x) => x.file.startsWith('tests/architecture/'))) {
      expect(doc, r.file).toContain(path.basename(r.file));
    }
  });
});

describe('week buckets and run distribution', () => {
  const buckets = weekBuckets(NOW, 2);

  it('makes newest-first 7-day windows ending now', () => {
    expect(buckets.map((b) => b.label)).toEqual(['2026-09-23 → 2026-09-30', '2026-09-16 → 2026-09-23']);
    expect(bucketOf(buckets, '2026-09-29T00:00:00Z')).toBe(0);
    expect(bucketOf(buckets, '2026-09-20T00:00:00Z')).toBe(1);
    expect(bucketOf(buckets, '2026-09-01T00:00:00Z')).toBe(-1);
  });

  it('classifies each run by its latest attempt', () => {
    const rows = runDistribution([
      { status: 'completed', conclusion: 'success', created_at: '2026-09-29T00:00:00Z' },
      { status: 'completed', conclusion: 'failure', created_at: '2026-09-29T00:00:00Z' },
      { status: 'completed', conclusion: 'cancelled', created_at: '2026-09-28T00:00:00Z' },
      { status: 'completed', conclusion: 'timed_out', created_at: '2026-09-28T00:00:00Z' },
      { status: 'in_progress', conclusion: null, created_at: '2026-09-30T11:00:00Z' },
      { status: 'completed', conclusion: 'success', created_at: '2026-09-20T00:00:00Z' },
      { status: 'completed', conclusion: 'success', created_at: '2026-08-01T00:00:00Z' }, // outside
    ], buckets);
    expect(rows[0]).toMatchObject({ total: 5, success: 1, failure: 1, cancelled: 1, other: 1, inProgress: 1 });
    expect(rows[1]).toMatchObject({ total: 1, success: 1 });
  });
});

describe('step durations', () => {
  const job = (steps: unknown[]) => ({ name: 'coverage', steps });
  const step = (name: string, conclusion: string, start: string, end: string) =>
    ({ name, conclusion, started_at: start, completed_at: end });

  it('keeps only successful runs of the named step, from any job', () => {
    const samples = stepDurations([
      job([step('Test + coverage', 'success', '2026-09-29T10:00:00Z', '2026-09-29T10:10:00Z')]),
      { name: 'lint-and-test', steps: [step('Test + coverage', 'success', '2026-09-20T10:00:00Z', '2026-09-20T10:05:00Z')] },
      job([step('Test + coverage', 'failure', '2026-09-29T10:00:00Z', '2026-09-29T10:01:00Z')]),
      job([step('Test', 'success', '2026-09-29T10:00:00Z', '2026-09-29T10:02:00Z')]),
      job([step('Test + coverage', 'success', '2026-09-29T10:00:00Z', null as unknown as string)]),
    ], 'Test + coverage');
    expect(samples.map((s) => s.secs)).toEqual([600, 300]);
  });

  it('computes nearest-rank quantiles per week', () => {
    expect(quantile([], 0.5)).toBeNull();
    expect(quantile([3, 1, 2], 0.5)).toBe(2);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
    const w = weeklyDurations([{ at: '2026-09-29T00:00:00Z', secs: 60 }, { at: '2026-09-29T01:00:00Z', secs: 120 }], weekBuckets(NOW, 2));
    expect(w[0]).toMatchObject({ n: 2, median: 60, p90: 120 });
    expect(w[1]).toMatchObject({ n: 0, median: null });
  });

  it('formats durations', () => {
    expect(fmtDuration(null)).toBe('—');
    expect(fmtDuration(48.4)).toBe('48s');
    expect(fmtDuration(725)).toBe('12m 05s');
  });
});

describe('e2e flakes', () => {
  it('parses the summary line the flake reporter actually prints', () => {
    // Round-trip through the real formatter, so a change to its wording
    // breaks this rather than silently turning every week into "no report".
    const { summary } = formatReport({
      suites: [],
      stats: { expected: 14, unexpected: 1, flaky: 2, skipped: 3 },
      errors: [],
    });
    const log = `2026-09-11T11:19:39.9Z ##[group]Run node scripts/e2e-flake-report.mjs\n2026-09-11T11:19:39.95Z ${summary}\n`;
    expect(parseFlakeSummary(log)).toEqual({ passed: 14, failed: 1, flaky: 2, skipped: 3 });
    expect(parseFlakeSummary('packaging failed')).toBeNull();
  });

  it('totals per week, counting over-budget attempts and missing reports', () => {
    const rows = weeklyFlakes([
      { at: '2026-09-29T00:00:00Z', summary: { passed: 15, failed: 0, flaky: 0, skipped: 0 } },
      { at: '2026-09-29T00:00:00Z', summary: { passed: 14, failed: 0, flaky: 1, skipped: 0 } },
      { at: '2026-09-29T00:00:00Z', summary: { passed: 13, failed: 0, flaky: 2, skipped: 0 } },
      { at: '2026-09-29T00:00:00Z', summary: null },
    ], weekBuckets(NOW, 1), 1);
    expect(rows[0]).toEqual({ label: '2026-09-23 → 2026-09-30', attempts: 4, noReport: 1, flakyTests: 3, withFlake: 2, overBudget: 1 });
  });
});

describe('fix: commits', () => {
  it('recognises conventional fix subjects only', () => {
    expect(isFixCommit('fix: x')).toBe(true);
    expect(isFixCommit('fix(ci): x')).toBe(true);
    expect(isFixCommit('fix!: x')).toBe(true);
    expect(isFixCommit('feat: fix: x')).toBe(false);
    expect(isFixCommit('fixup the thing')).toBe(false);
    expect(isFixCommit('Revert "fix: x"')).toBe(false);
  });

  it('parses git log output', () => {
    const log = ['aaa\x1f2026-09-29\x1ffix(links): x (#1)', 'bbb\x1f2026-09-28\x1ffeat: y', ''].join('\n');
    expect(parseFixCommits(log)).toEqual([{ sha: 'aaa', date: '2026-09-29', subject: 'fix(links): x (#1)' }]);
  });
});

describe('findDashboardIssue', () => {
  const issue = (n: number, title: string, labels: string[], extra: Record<string, unknown> = {}) =>
    ({ number: n, title, state: 'open', labels: labels.map((name) => ({ name })), ...extra });

  it('needs both the label and the exact title, and prefers the oldest', () => {
    expect(findDashboardIssue([])).toBeNull();
    expect(findDashboardIssue([issue(5, DASHBOARD_TITLE, [])])).toBeNull();
    expect(findDashboardIssue([issue(5, 'Something else', [DASHBOARD_LABEL])])).toBeNull();
    expect(findDashboardIssue([issue(5, DASHBOARD_TITLE, [DASHBOARD_LABEL], { pull_request: {} })])).toBeNull();
    expect(findDashboardIssue([
      issue(9, DASHBOARD_TITLE, [DASHBOARD_LABEL]),
      issue(7, DASHBOARD_TITLE, ['build', DASHBOARD_LABEL]),
    ])?.number).toBe(7);
  });
});

describe('BENCH_ISSUE_TITLE', () => {
  it('is the title bench.yml files its gate failure under', () => {
    const bench = fs.readFileSync(path.join(ROOT, '.github/workflows/bench.yml'), 'utf-8');
    expect(bench).toContain(`const TITLE = '${BENCH_ISSUE_TITLE}';`);
  });
});

describe('renderDashboard', () => {
  const buckets = weekBuckets(NOW, 1);
  const full = () => ({
    generatedAt: NOW,
    weeks: 1,
    ref: 'main',
    sha: 'abcdef0123456789',
    runUrl: 'https://example.test/run/1',
    ci: { rows: runDistribution([{ status: 'completed', conclusion: 'success', created_at: '2026-09-29T00:00:00Z' }], buckets) },
    durations: { byStep: { Test: weeklyDurations([{ at: '2026-09-29T00:00:00Z', secs: 500 }], buckets) } },
    flakes: { budget: 1, rows: weeklyFlakes([], buckets, 1) },
    bench: { recent: [], latestScheduled: null, openIssue: { number: 42 } },
    coverage: { head: 'abc', rows: [{ label: 'main', path: 'src/main/', lines: 10, hits: 8, partials: 1, misses: 1, coverage: 80 }] },
    ratchets: { sinceLabel: 'At x', rows: [{ label: 'Swallows', file: 'f.ts', name: 'S', value: 3, detail: '2 files', previous: 5 }] },
    fixes: { tag: 'v2.0.2', tagDate: '2026-09-09', total: 10, commits: [{ sha: 'a'.repeat(40), date: '2026-09-29', subject: 'fix: y' }] },
  });

  it('renders every section with its data', () => {
    const md = renderDashboard(full());
    expect(md).toMatch(/^# Quality dashboard \(weekly\)/);
    expect(md).toContain('| 2026-09-23 → 2026-09-30 | 1 | 1 (100%) | 0 | 0 | 0 | 0 |');
    expect(md).toContain('8m 20s');
    expect(md).toContain('Open gate-failure issue: #42.');
    expect(md).toContain('| `src/main/` (main) | 10 | 8 | 1 | 1 | 80.00% |');
    expect(md).toContain('| Swallows | 3 (2 files) | 5 | -2 |');
    expect(md).toContain('**1** `fix:` commit on `main` since `v2.0.2`');
    expect(md).not.toContain('Unavailable');
    expect(collectErrors(full())).toEqual([]);
  });

  it('renders a failed source as unavailable, never as zeros, and lists it', () => {
    const d = {
      ...full(),
      coverage: { error: 'Codecov branches/main: HTTP 503' },
      ci: { error: 'gh: HTTP 502' },
      ratchets: { sinceLabel: 'At x', rows: [{ label: 'Cycles', file: 'f.ts', name: 'C', error: 'const C not found', previous: null }] },
    };
    const md = renderDashboard(d);
    expect(md).toContain('_Unavailable: Codecov branches/main: HTTP 503_');
    expect(md).toContain('_Unavailable: gh: HTTP 502_');
    expect(md).toContain('| Cycles | _Unavailable: const C not found_ | — | — |');
    expect(md).toContain('## Unavailable this week');
    expect(collectErrors(d)).toEqual([
      'ci: gh: HTTP 502',
      'coverage: Codecov branches/main: HTTP 503',
      'ratchet Cycles: const C not found',
    ]);
  });

  it('stays under the issue body limit', () => {
    const d = full();
    d.fixes.commits = Array.from({ length: 5000 }, (_, i) => ({ sha: String(i).padStart(40, '0'), date: '2026-09-29', subject: `fix: ${'x'.repeat(200)}` }));
    const md = renderDashboard(d);
    expect(md.length).toBeLessThanOrEqual(65536);
    expect(md).toContain('… and 4960 more');
  });
});
