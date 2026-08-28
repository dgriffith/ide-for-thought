/**
 * E2E flake visibility (#1946). Playwright retries a test twice in CI but
 * nothing aggregated the "retry #N" lines its `list` reporter prints — a
 * test that needed a retry every run was indistinguishable from one that
 * always passed first try. These tests pin the parsing logic against
 * Playwright's own JSON report shape and the CLI's exit-code contract.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectRetriedTests, formatReport } from '../../scripts/e2e-flake-report.mjs';

const SCRIPT = path.resolve(__dirname, '../../scripts/e2e-flake-report.mjs');

function report(overrides: { flaky?: number; failed?: number } = {}) {
  return {
    suites: [
      {
        title: 'a11y.spec.ts',
        specs: [
          {
            title: 'flaky test',
            tests: [{ results: [{ status: 'failed', retry: 0 }, { status: 'passed', retry: 1 }] }],
          },
          {
            title: 'solid test',
            tests: [{ results: [{ status: 'passed', retry: 0 }] }],
          },
          {
            title: 'always-fails test',
            tests: [{ results: [{ status: 'failed', retry: 0 }, { status: 'failed', retry: 1 }, { status: 'failed', retry: 2 }] }],
          },
        ],
        suites: [
          {
            title: 'nested',
            specs: [
              {
                title: 'nested flaky test',
                tests: [{ results: [{ status: 'failed', retry: 0 }, { status: 'passed', retry: 1 }] }],
              },
            ],
            suites: [],
          },
        ],
      },
    ],
    stats: { expected: 2, unexpected: 1, flaky: overrides.flaky ?? 2, skipped: 0, ...overrides },
  };
}

describe('collectRetriedTests', () => {
  it('finds every test with more than one result, at any nesting depth', () => {
    const retried = collectRetriedTests(report());
    expect(retried.map((r) => r.title)).toEqual([
      'a11y.spec.ts › flaky test',
      'a11y.spec.ts › always-fails test',
      'a11y.spec.ts › nested › nested flaky test',
    ]);
  });

  it('ignores a test that passed on the first attempt', () => {
    const retried = collectRetriedTests(report());
    expect(retried.some((r) => r.title.includes('solid test'))).toBe(false);
  });

  it('reports the final status and attempt count, including a retry that never recovered', () => {
    const retried = collectRetriedTests(report());
    const alwaysFails = retried.find((r) => r.title.includes('always-fails'));
    expect(alwaysFails).toMatchObject({ attempts: 3, finalStatus: 'failed' });
    const flaky = retried.find((r) => r.title === 'a11y.spec.ts › flaky test');
    expect(flaky).toMatchObject({ attempts: 2, finalStatus: 'passed' });
  });

  it('returns nothing for a report with no suites', () => {
    expect(collectRetriedTests({})).toEqual([]);
  });
});

describe('formatReport', () => {
  it('summarizes stats and lists every retried test as a markdown table', () => {
    const { summary, body, flakyCount } = formatReport(report());
    expect(summary).toContain('2 flaky');
    expect(body).toContain('| a11y.spec.ts › flaky test | 2 | passed |');
    expect(flakyCount).toBe(2);
  });

  it('says plainly that nothing needed a retry when the run was clean', () => {
    const clean = { suites: [], stats: { expected: 5, unexpected: 0, flaky: 0, skipped: 0 } };
    const { body } = formatReport(clean);
    expect(body).toBe('No test needed a retry.');
  });
});

describe('CLI contract', () => {
  let dir: string;
  const withTempDir = (fn: (dir: string) => void) => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-flake-'));
    try {
      fn(dir);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  };

  function run(args: string[]): { status: number; stdout: string } {
    try {
      const stdout = execFileSync('node', [SCRIPT, ...args], { encoding: 'utf-8' });
      return { status: 0, stdout };
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      return { status: e.status, stdout: e.stdout + e.stderr };
    }
  }

  it('exits 0 by default even with flaky tests — a retry does not fail the job (#1946 decision)', () => {
    withTempDir((d) => {
      const p = path.join(d, 'report.json');
      fs.writeFileSync(p, JSON.stringify(report()));
      const { status, stdout } = run([p]);
      expect(status).toBe(0);
      expect(stdout).toContain('2 flaky');
    });
  });

  it('exits 1 once flaky count exceeds an explicit --max-flaky budget', () => {
    withTempDir((d) => {
      const p = path.join(d, 'report.json');
      fs.writeFileSync(p, JSON.stringify(report()));
      const { status, stdout } = run([p, '--max-flaky', '0']);
      expect(status).toBe(1);
      expect(stdout).toContain('exceeds the budget of 0');
    });
  });

  it('stays under a --max-flaky budget that covers the observed count', () => {
    withTempDir((d) => {
      const p = path.join(d, 'report.json');
      fs.writeFileSync(p, JSON.stringify(report()));
      const { status } = run([p, '--max-flaky', '5']);
      expect(status).toBe(0);
    });
  });

  it('exits 0 without a stack trace when the report was never produced (e.g. packaging crashed first)', () => {
    withTempDir((d) => {
      const missing = path.join(d, 'never-written.json');
      const { status, stdout } = run([missing]);
      expect(status).toBe(0);
      expect(stdout).toContain('nothing to analyze');
    });
  });
});
