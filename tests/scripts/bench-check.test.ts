/**
 * The benchmark regression gate (#1099 / #1945) had no test of its own — the
 * mechanism (an absolute `budgetMs` ceiling, a per-benchmark `tolerance`
 * override) was built but never exercised, so a change here could silently
 * stop failing the gate it exists to enforce. Spawns the real script against
 * crafted baseline/current fixtures and asserts on its actual CLI contract
 * (exit code + stdout), since it's invoked as a subprocess from the Bench
 * workflow, not imported as a module.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const SCRIPT = path.resolve(__dirname, '../../scripts/bench-check.mjs');

function run(args: string[]): { status: number; stdout: string } {
  try {
    const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf-8' });
    return { status: 0, stdout };
  } catch (err) {
    const e = err as { status: number; stdout: string; stderr: string };
    return { status: e.status, stdout: e.stdout + e.stderr };
  }
}

/** vitest `--outputJson` shape: files → groups → benchmarks. */
function currentJson(benchmarks: Array<{ name: string; mean: number; hz?: number }>) {
  return { files: [{ groups: [{ benchmarks: benchmarks.map((b) => ({ hz: 1000 / b.mean, ...b })) }] }] };
}

function writeTemp(dir: string, name: string, data: unknown): string {
  const p = path.join(dir, name);
  fs.writeFileSync(p, JSON.stringify(data));
  return p;
}

describe('bench-check.mjs', () => {
  let dir: string;
  const withTempDir = (fn: (dir: string) => void) => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-bench-check-'));
    try {
      fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  it('passes when current is within tolerance and under budget', () => {
    withTempDir((d) => {
      const baseline = writeTemp(d, 'baseline.json', {
        tolerance: 2,
        benchmarks: [{ name: 'slow op', mean: 100, hz: 10, budgetMs: 200 }],
      });
      const current = writeTemp(d, 'current.json', currentJson([{ name: 'slow op', mean: 150 }]));
      const { status, stdout } = run(['--current', current, '--baseline', baseline]);
      expect(status).toBe(0);
      expect(stdout).toContain('No benchmark regressed beyond tolerance');
    });
  });

  it('fails the ceiling check when a benchmark breaches budgetMs even within ratio tolerance', () => {
    withTempDir((d) => {
      // 250ms is only 1.25x the 200ms baseline (well under the 2x ratio
      // tolerance), but it breaches the 220ms budgetMs ceiling — this is
      // exactly the "deliberate regression" case #1945 asks to prove fires.
      const baseline = writeTemp(d, 'baseline.json', {
        tolerance: 2,
        benchmarks: [{ name: 'scale op', mean: 200, hz: 5, budgetMs: 220 }],
      });
      const current = writeTemp(d, 'current.json', currentJson([{ name: 'scale op', mean: 250 }]));
      const { status, stdout } = run(['--current', current, '--baseline', baseline]);
      expect(status).toBe(1);
      expect(stdout).toContain('OVER BUDGET');
      expect(stdout).toContain('exceeds budget');
    });
  });

  it('fails on ratio regression using the file-level default tolerance', () => {
    withTempDir((d) => {
      const baseline = writeTemp(d, 'baseline.json', {
        tolerance: 2,
        benchmarks: [{ name: 'noisy op', mean: 100, hz: 10, budgetMs: null }],
      });
      const current = writeTemp(d, 'current.json', currentJson([{ name: 'noisy op', mean: 250 }])); // 2.5x
      const { status, stdout } = run(['--current', current, '--baseline', baseline]);
      expect(status).toBe(1);
      expect(stdout).toContain('REGRESSED');
    });
  });

  it('a per-benchmark tolerance overrides the file-level default', () => {
    withTempDir((d) => {
      // 1.5x would pass the file-level 2x tolerance, but this benchmark's
      // own tighter 1.3x must catch it instead.
      const baseline = writeTemp(d, 'baseline.json', {
        tolerance: 2,
        benchmarks: [{ name: 'low-variance op', mean: 100, hz: 10, budgetMs: null, tolerance: 1.3 }],
      });
      const current = writeTemp(d, 'current.json', currentJson([{ name: 'low-variance op', mean: 150 }]));
      const { status, stdout } = run(['--current', current, '--baseline', baseline]);
      expect(status).toBe(1);
      expect(stdout).toContain('REGRESSED');
      expect(stdout).toContain('1.3');
    });
  });

  it('an explicit --tolerance flag overrides every benchmark, including its own tolerance', () => {
    withTempDir((d) => {
      const baseline = writeTemp(d, 'baseline.json', {
        tolerance: 2,
        benchmarks: [{ name: 'low-variance op', mean: 100, hz: 10, budgetMs: null, tolerance: 1.3 }],
      });
      // 1.5x would fail the benchmark's own 1.3x tolerance, but an explicit
      // --tolerance 3 on the CLI should let it through regardless.
      const current = writeTemp(d, 'current.json', currentJson([{ name: 'low-variance op', mean: 150 }]));
      const { status } = run(['--current', current, '--baseline', baseline, '--tolerance', '3']);
      expect(status).toBe(0);
    });
  });

  it('--update preserves hand-set budgetMs/tolerance/gate while refreshing mean/hz', () => {
    withTempDir((d) => {
      const baselinePath = writeTemp(d, 'baseline.json', {
        tolerance: 2,
        benchmarks: [
          { name: 'scale op', mean: 100, hz: 10, budgetMs: 220, tolerance: 1.3 },
          { name: 'noisy op', mean: 50, hz: 20, budgetMs: null, gate: false },
        ],
      });
      const current = writeTemp(
        d,
        'current.json',
        currentJson([
          { name: 'scale op', mean: 105 },
          { name: 'noisy op', mean: 60 },
        ]),
      );
      const { status } = run(['--current', current, '--baseline', baselinePath, '--update']);
      expect(status).toBe(0);

      const updated = JSON.parse(fs.readFileSync(baselinePath, 'utf-8'));
      const scaleOp = updated.benchmarks.find((b: { name: string }) => b.name === 'scale op');
      const noisyOp = updated.benchmarks.find((b: { name: string }) => b.name === 'noisy op');
      expect(scaleOp.mean).toBe(105);
      expect(scaleOp.budgetMs).toBe(220);
      expect(scaleOp.tolerance).toBe(1.3);
      expect(noisyOp.mean).toBe(60);
      expect(noisyOp.gate).toBe(false);
    });
  });
});
