/**
 * @vitest-environment node
 *
 * The per-PR bench gate (#2386): base vs head on one runner, each side scored
 * by its best run, failing above a head/base ratio.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { comparePrBench, formatPrBench, PR_BENCH_FILES, PR_BENCH_TOLERANCE } from '../../scripts/lib/pr-bench.mjs';

const SCRIPT = path.resolve(__dirname, '../../scripts/pr-bench-compare.mjs');
const ROOT = path.resolve(__dirname, '../..');

const run = (entries: Record<string, number>) => new Map(Object.entries(entries).map(([k, mean]) => [k, { mean }]));

/** A vitest `--reporter=json` bench report with one task per entry. */
function report(entries: Record<string, number>) {
  return {
    testResults: [{
      assertionResults: [{
        benchmarks: [{ tasks: Object.entries(entries).map(([name, mean]) => ({ name, latency: { mean }, throughput: { mean: 1000 / mean } })) }],
      }],
    }],
  };
}

describe('comparePrBench', () => {
  it('scores each side by its best run, so one noisy run does not fail a PR', () => {
    const r = comparePrBench({
      base: [run({ save: 10 }), run({ save: 11 })],
      // A slow patch of the runner hit the first head run; the second is clean.
      head: [run({ save: 25 }), run({ save: 10.5 })],
    });
    expect(r.rows[0]!.ratio).toBeCloseTo(1.05);
    expect(r.regressed).toEqual([]);
  });

  it('fails when the head is slower than the tolerance on every run', () => {
    const r = comparePrBench({ base: [run({ save: 10 }), run({ save: 10 })], head: [run({ save: 30 }), run({ save: 32 })] });
    expect(r.regressed.map((x) => x.name)).toEqual(['save']);
    expect(r.rows[0]!.ratio).toBeCloseTo(3);
  });

  it('does not fail on overlapping runs, however bad the ratio of bests looks', () => {
    // A lucky fast base run makes the ratio 2.5x, but the sides interleave:
    // the head's best (25) is faster than the base's worst (30). That's noise.
    const r = comparePrBench({ base: [run({ save: 10 }), run({ save: 30 })], head: [run({ save: 25 }), run({ save: 26 })] });
    expect(r.rows[0]!.ratio).toBeCloseTo(2.5);
    expect(r.regressed).toEqual([]);
  });

  it('does not fail the identical-code noise measured in the dry run (0.76x-1.70x)', () => {
    const r = comparePrBench({ base: [run({ cold: 1.37 }), run({ cold: 2.26 })], head: [run({ cold: 2.33 }), run({ cold: 2.4 })] });
    expect(r.regressed).toEqual([]);
  });

  it('holds the default tolerance well under the 3-3.8x regression it exists for (#2242)', () => {
    expect(PR_BENCH_TOLERANCE).toBeGreaterThan(1);
    expect(PR_BENCH_TOLERANCE).toBeLessThan(3);
  });

  it('reports benches new in the PR, or gone from it, instead of comparing them', () => {
    const r = comparePrBench({ base: [run({ old: 1, both: 1 })], head: [run({ both: 1, fresh: 1 })] });
    expect(r.rows.map((x) => x.name)).toEqual(['both']);
    expect(r.added).toEqual(['fresh']);
    expect(r.missing).toEqual(['old']);
  });

  it('keeps a bench whose run errored on one side, scoring it from the runs that worked', () => {
    const r = comparePrBench({ base: [run({ save: 10 }), run({})], head: [run({ save: 10 }), run({ save: 10 })] });
    expect(r.rows.map((x) => x.name)).toEqual(['save']);
  });

  it('formats a table with the verdict, ratio and noise', () => {
    const md = formatPrBench(comparePrBench({ base: [run({ save: 10 })], head: [run({ save: 40 })] }));
    expect(md).toContain('1 benchmark(s) slower than');
    expect(md).toMatch(/\| save \| 10\.00 ms \| 40\.00 ms \| 4\.00× ❌ \|/);
  });
});

describe('PR_BENCH_FILES', () => {
  it('names bench files that exist', () => {
    for (const f of PR_BENCH_FILES) expect(fs.existsSync(path.join(ROOT, f)), f).toBe(true);
  });
});

describe('pr-bench-compare.mjs (CLI)', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pr-bench-'));
  const write = (name: string, body: unknown) => {
    const p = path.join(dir, name);
    fs.writeFileSync(p, JSON.stringify(body));
    return p;
  };
  const cli = (args: string[]) => {
    try {
      return { code: 0, out: execFileSync('node', [SCRIPT, ...args], { encoding: 'utf-8', stdio: 'pipe' }) };
    } catch (e) {
      const err = e as { status: number; stdout: string };
      return { code: err.status, out: err.stdout };
    }
  };

  it('--list prints the bench files', () => {
    expect(cli(['--list']).out.trim().split('\n')).toEqual(PR_BENCH_FILES);
  });

  it('exits 0 on no regression and appends the table to --summary', () => {
    const summary = path.join(dir, 'summary.md');
    const r = cli(['--base', write('b.json', report({ save: 10 })), '--head', write('h.json', report({ save: 11 })), '--summary', summary]);
    expect(r.code).toBe(0);
    expect(fs.readFileSync(summary, 'utf-8')).toContain('| save |');
  });

  it('exits 1 on a regression', () => {
    const r = cli(['--base', write('b2.json', report({ save: 10 })), '--head', write('h2.json', report({ save: 40 }))]);
    expect(r.code).toBe(1);
    expect(r.out).toContain('❌');
  });

  it('exits 1 when nothing was compared — a gate that ran no benches must not pass', () => {
    const r = cli(['--base', path.join(dir, 'missing.json'), '--head', write('h3.json', report({ save: 1 }))]);
    expect(r.code).toBe(1);
  });
});
