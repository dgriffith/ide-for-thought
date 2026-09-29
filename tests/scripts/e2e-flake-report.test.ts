/**
 * E2E flake visibility (#1946) and budget (#2379).
 *
 * Playwright retries a test twice in CI; #1946 made those retries visible and
 * #2379 made them count — more than `FLAKE_BUDGET` flaky tests in one run
 * fails the job. These tests pin the parsing against Playwright's own JSON
 * report shape, the budget verdict, and the CLI's exit-code contract.
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  FLAKE_BUDGET,
  collectAttemptDiagnostics,
  collectFlakyTests,
  collectRetriedTests,
  collectRunErrors,
  evaluateFlakeBudget,
  formatReport,
  type PlaywrightReport,
} from '../../scripts/lib/e2e-flake-budget.mjs';

const SCRIPT = path.resolve(__dirname, '../../scripts/e2e-flake-report.mjs');

const passed = [{ status: 'passed', retry: 0 }];
const flakyResults = [{ status: 'failed', retry: 0 }, { status: 'passed', retry: 1 }];
const failedResults = [{ status: 'failed', retry: 0 }, { status: 'failed', retry: 1 }, { status: 'timedOut', retry: 2 }];

function spec(title: string, results: unknown[]) {
  return { title, tests: [{ results }] };
}

/** A report with `flaky` flaky tests (the first one nested), optional hard
 *  failures and run-level errors — the shape Playwright's `json` reporter
 *  writes. */
function report(opts: { flaky?: number; failed?: number; errors?: string[] } = {}): PlaywrightReport {
  const flaky = opts.flaky ?? 2;
  const failed = opts.failed ?? 0;
  const top = [spec('solid test', passed)];
  const nested: ReturnType<typeof spec>[] = [];
  for (let i = 0; i < flaky; i++) (i === 0 ? nested : top).push(spec(`flaky test ${i}`, flakyResults));
  for (let i = 0; i < failed; i++) top.push(spec(`always-fails test ${i}`, failedResults));
  return {
    suites: [{ title: 'a11y.spec.ts', specs: top, suites: [{ title: 'nested', specs: nested, suites: [] }] }],
    stats: { expected: 1, unexpected: failed, flaky, skipped: 0 },
    errors: (opts.errors ?? []).map((message) => ({ message })),
  };
}

describe('collectRetriedTests / collectFlakyTests', () => {
  it('finds every retried test at any nesting depth, win or lose', () => {
    const titles = collectRetriedTests(report({ flaky: 2, failed: 1 })).map((r) => r.title);
    expect(titles).toEqual([
      'a11y.spec.ts › flaky test 1',
      'a11y.spec.ts › always-fails test 0',
      'a11y.spec.ts › nested › flaky test 0',
    ]);
  });

  it('ignores a test that passed on the first attempt', () => {
    expect(collectRetriedTests(report()).some((r) => r.title.includes('solid'))).toBe(false);
  });

  it('reports the final status and attempt count, including a retry that never recovered', () => {
    const retried = collectRetriedTests(report({ flaky: 1, failed: 1 }));
    expect(retried.find((r) => r.title.includes('always-fails'))).toMatchObject({ attempts: 3, finalStatus: 'timedOut' });
    expect(retried.find((r) => r.title.includes('flaky'))).toMatchObject({ attempts: 2, finalStatus: 'passed' });
  });

  it('counts only a retry that then PASSED as flaky — a test that never passed is a failure', () => {
    expect(collectFlakyTests(report({ flaky: 1, failed: 2 })).map((r) => r.title)).toEqual([
      'a11y.spec.ts › nested › flaky test 0',
    ]);
  });

  it('returns nothing for a report with no suites', () => {
    expect(collectRetriedTests({})).toEqual([]);
  });
});

describe('collectRunErrors', () => {
  it('returns the first line of each error outside any test, ANSI stripped', () => {
    const json = report({
      errors: ['\u001b[31mWorker teardown timeout of 60000ms exceeded.\u001b[39m\n\nFailed worker ran 15 tests'],
    });
    expect(collectRunErrors(json)).toEqual(['Worker teardown timeout of 60000ms exceeded.']);
  });

  it('is empty when the report has no errors field', () => {
    expect(collectRunErrors({ suites: [] })).toEqual([]);
  });
});

describe('evaluateFlakeBudget', () => {
  it('defaults to a budget of 1 (the #2379 measurement)', () => {
    expect(FLAKE_BUDGET).toBe(1);
    expect(evaluateFlakeBudget(report({ flaky: 1 })).maxFlaky).toBe(1);
  });

  it('absorbs a single flake — the Electron-boot hiccup retries exist for (#1097)', () => {
    const r = evaluateFlakeBudget(report({ flaky: 1 }));
    expect(r.ok).toBe(true);
    expect(r.verdict).toContain('within flake budget: 1 flaky ≤ 1');
  });

  it('fails at budget + 1 and names every flaky test', () => {
    const r = evaluateFlakeBudget(report({ flaky: 2 }));
    expect(r.ok).toBe(false);
    expect(r.verdict.split('\n')[0]).toBe('✗ flake budget exceeded: 2 flaky > 1');
    expect(r.verdict).toContain('a11y.spec.ts › flaky test 1 (passed on attempt 2)');
    expect(r.verdict).toContain('a11y.spec.ts › nested › flaky test 0 (passed on attempt 2)');
  });

  it('honours an explicit budget, including 0', () => {
    expect(evaluateFlakeBudget(report({ flaky: 1 }), 0).ok).toBe(false);
    expect(evaluateFlakeBudget(report({ flaky: 3 }), 5).ok).toBe(true);
  });

  it('a clean run is within budget and says nothing about re-running', () => {
    const r = evaluateFlakeBudget(report({ flaky: 0 }));
    expect(r.ok).toBe(true);
    expect(r.verdict).not.toContain('re-running');
  });

  // Run 36605071541 attempt 1 (#2379): ONE flaky test, and a red job. The flake
  // table was the only thing the report printed, so it read as the cause. It
  // wasn't — Playwright exited 1 on the worker teardown timeout.
  it('explains a red Playwright step caused by an error outside any test, without charging it to the budget', () => {
    const r = evaluateFlakeBudget(report({ flaky: 1, errors: ['Worker teardown timeout of 60000ms exceeded.'] }));
    expect(r.ok).toBe(true);
    expect(r.playwrightFailed).toBe(true);
    expect(r.verdict).toContain('1 error(s) outside any test failed the Playwright step');
    expect(r.verdict).toContain('Worker teardown timeout of 60000ms exceeded.');
  });

  it('explains a red Playwright step caused by a test that failed every attempt', () => {
    const r = evaluateFlakeBudget(report({ flaky: 0, failed: 1 }));
    expect(r.ok).toBe(true);
    expect(r.playwrightFailed).toBe(true);
    expect(r.verdict).toContain('1 test(s) failed on every attempt');
  });
});

// #2458: the a11y › proposals panel hang — attempt 1 spent its whole budget
// somewhere, and the report could only say "Test timeout exceeded". These are
// the shapes the e2e helpers now leave on an attempt, taken from a real run
// with the main process deliberately wedged.
const KILL = 'app did not quit within 10s after a11y [light theme] › proposals panel (closed by the post-test reaper) — killed (SIGKILL, pid 4242, after 14.0s)';
const PROBE = 'main process: NO answer to a trivial evaluate within 2000ms — main is wedged';
function hangReport(): PlaywrightReport {
  const hung = {
    status: 'timedOut',
    retry: 0,
    duration: 74_000,
    errors: [
      { message: '\u001b[31mTest timeout of 60000ms exceeded.\u001b[39m' },
      { message: `Error: ${KILL}\n${PROBE}` },
    ],
    annotations: [{ type: 'app-killed', description: `${KILL}\n${PROBE}` }, { type: 'issue', description: 'unrelated' }],
    steps: [
      { title: 'launch Minerva', duration: 400 },
      { title: 'wait for workspace', duration: 600 },
      { title: 'seed proposal (main-process hook)', duration: 58_900, error: { message: 'Test timeout of 60000ms exceeded.' } },
      { title: 'close Minerva', duration: 14_000, error: { message: KILL } },
    ],
  };
  const retried = { status: 'passed', retry: 1, duration: 2_100, errors: [], annotations: [], steps: [] };
  const seedHang = {
    status: 'failed',
    retry: 0,
    duration: 19_500,
    errors: [{ message: `Error: seedProposal (app.evaluate in the main process) did not settle within 15000ms\n${PROBE}` }],
    annotations: [{ type: 'hang', description: `seedProposal (app.evaluate in the main process) did not settle within 15000ms\n${PROBE}` }],
    steps: [{
      title: 'outer',
      duration: 19_000,
      error: { message: 'x' },
      steps: [{ title: 'seed proposal (main-process hook)', duration: 19_000, error: { message: 'x' } }],
    }],
  };
  const plain = {
    status: 'failed',
    retry: 0,
    duration: 900,
    errors: [{ message: 'Error: expect(locator).toBeVisible() failed\nmore' }],
    steps: [{ title: 'launch Minerva', duration: 300 }],
  };
  return {
    suites: [{
      title: 'a11y.spec.ts',
      specs: [
        spec('solid test', passed),
        spec('proposals panel', [hung, retried]),
        spec('seeded', [seedHang, retried]),
        spec('plain failure', [plain, retried]),
      ],
    }],
    stats: { expected: 1, unexpected: 0, flaky: 3, skipped: 0 },
    errors: [],
  };
}

describe('collectAttemptDiagnostics (#2458)', () => {
  it('lists only attempts that did not pass, with the step each ended in', () => {
    const attempts = collectAttemptDiagnostics(hangReport());
    expect(attempts.map((a) => [a.title, a.attempt, a.status])).toEqual([
      ['a11y.spec.ts › proposals panel', 1, 'timedOut'],
      ['a11y.spec.ts › seeded', 1, 'failed'],
      ['a11y.spec.ts › plain failure', 1, 'failed'],
    ]);
    expect(attempts[0]!.step).toEqual({ title: 'seed proposal (main-process hook)', duration: 58_900 });
  });

  it('names the deepest errored step, not its parent', () => {
    expect(collectAttemptDiagnostics(hangReport())[1]!.step?.title).toBe('outer › seed proposal (main-process hook)');
  });

  it('does not guess a step when the failure was outside every named one', () => {
    expect(collectAttemptDiagnostics(hangReport())[2]!.step).toBeNull();
  });

  it("reports the attempt's own error ahead of a teardown kill, ANSI stripped, first line only", () => {
    const [timedOut, seeded] = collectAttemptDiagnostics(hangReport());
    expect(timedOut!.error).toBe('Test timeout of 60000ms exceeded.');
    expect(seeded!.error).toBe('Error: seedProposal (app.evaluate in the main process) did not settle within 15000ms');
  });

  it('keeps the helper diagnostics (hang, app-killed) with their probe lines, and drops other annotations', () => {
    const [timedOut, seeded] = collectAttemptDiagnostics(hangReport());
    expect(timedOut!.notes).toEqual([{ type: 'app-killed', text: `${KILL}\n${PROBE}` }]);
    expect(seeded!.notes.map((n) => n.type)).toEqual(['hang']);
  });

  it('lists a passing attempt that somehow carries a kill — a silent kill is the thing to prevent', () => {
    const json: PlaywrightReport = {
      suites: [{ title: 'x.spec.ts', specs: [spec('t', [{ status: 'passed', retry: 0, annotations: [{ type: 'app-killed', description: KILL }] }])] }],
    };
    expect(collectAttemptDiagnostics(json)).toHaveLength(1);
  });

  it('is empty for a clean run', () => {
    expect(collectAttemptDiagnostics(report({ flaky: 0 }))).toEqual([]);
  });
});

describe('evaluateFlakeBudget — hang diagnostics (#2458)', () => {
  it('names every killed app, and every failed attempt with its step, error and probe', () => {
    const r = evaluateFlakeBudget(hangReport(), 5);
    expect(r.killedApps).toEqual([KILL]);
    expect(r.verdict).toContain('✗ 1 app(s) under test would not quit and were killed');
    expect(r.verdict).toContain(
      'a11y.spec.ts › proposals panel — attempt 1 timedOut after 74.0s in step "seed proposal (main-process hook)" (58.9s)',
    );
    expect(r.verdict).toContain(`      app-killed: ${KILL}`);
    expect(r.verdict).toContain(`      ${PROBE}`);
    expect(r.verdict).toContain('a11y.spec.ts › plain failure — attempt 1 failed after 0.9s (not inside a named step)');
  });

  it('a kill does not by itself change the budget verdict — the killed attempt already counts as a flake or a failure', () => {
    expect(evaluateFlakeBudget(hangReport(), 3).ok).toBe(true);
    expect(evaluateFlakeBudget(hangReport(), 2).ok).toBe(false);
  });

  it('says nothing about kills or failed attempts on a clean run', () => {
    const r = evaluateFlakeBudget(report({ flaky: 0 }));
    expect(r.verdict).not.toContain('killed');
    expect(r.verdict).not.toContain('Failed attempts');
  });
});

describe('formatReport', () => {
  it('summarizes stats and lists every retried test as a markdown table', () => {
    const { summary, body, flakyCount } = formatReport(report());
    expect(summary).toContain('2 flaky');
    expect(body).toContain('| a11y.spec.ts › flaky test 1 | 2 | passed |');
    expect(flakyCount).toBe(2);
  });

  it('says plainly that nothing needed a retry when the run was clean', () => {
    const clean = { suites: [], stats: { expected: 5, unexpected: 0, flaky: 0, skipped: 0 } };
    expect(formatReport(clean).body).toBe('No test needed a retry.');
  });
});

describe('CLI contract', () => {
  function withReport(json: unknown, fn: (p: string) => void) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'minerva-e2e-flake-'));
    try {
      const p = path.join(dir, 'report.json');
      fs.writeFileSync(p, JSON.stringify(json));
      fn(p);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }

  function run(args: string[], env: Record<string, string> = {}): { status: number; stdout: string } {
    try {
      const stdout = execFileSync('node', [SCRIPT, ...args], {
        encoding: 'utf-8',
        env: { ...process.env, GITHUB_STEP_SUMMARY: '', ...env },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      return { status: 0, stdout };
    } catch (err) {
      const e = err as { status: number; stdout: string; stderr: string };
      return { status: e.status, stdout: e.stdout + e.stderr };
    }
  }

  it('exits 0 with one flaky test — within the default budget', () => {
    withReport(report({ flaky: 1 }), (p) => {
      const { status, stdout } = run([p]);
      expect(status).toBe(0);
      expect(stdout).toContain('within flake budget: 1 flaky ≤ 1');
    });
  });

  it('exits 1 with two flaky tests, saying why and emitting an annotation', () => {
    withReport(report({ flaky: 2 }), (p) => {
      const { status, stdout } = run([p]);
      expect(status).toBe(1);
      expect(stdout).toContain('flake budget exceeded: 2 flaky > 1');
      expect(stdout).toContain('::error title=E2E flake budget exceeded::flake budget exceeded: 2 flaky > 1');
    });
  });

  it('--max-flaky overrides the default in both directions', () => {
    withReport(report({ flaky: 2 }), (p) => expect(run([p, '--max-flaky', '5']).status).toBe(0));
    withReport(report({ flaky: 1 }), (p) => expect(run([p, '--max-flaky', '0']).status).toBe(1));
  });

  it('rejects a non-integer --max-flaky rather than silently comparing against NaN', () => {
    withReport(report({ flaky: 5 }), (p) => expect(run([p, '--max-flaky', 'lots']).status).not.toBe(0));
  });

  it('appends the table and the verdict to $GITHUB_STEP_SUMMARY', () => {
    withReport(report({ flaky: 2 }), (p) => {
      const summary = path.join(path.dirname(p), 'summary.md');
      run([p], { GITHUB_STEP_SUMMARY: summary });
      const md = fs.readFileSync(summary, 'utf-8');
      expect(md).toContain('## E2E flake report');
      expect(md).toContain('| a11y.spec.ts › flaky test 1 | 2 | passed |');
      expect(md).toContain('flake budget exceeded: 2 flaky > 1');
    });
  });

  it('raises a ::warning annotation per killed app, even when the budget holds (#2458)', () => {
    withReport(hangReport(), (p) => {
      const { status, stdout } = run([p, '--max-flaky', '5']);
      expect(status).toBe(0);
      expect(stdout).toContain(`::warning title=E2E app under test was killed::${KILL}`);
    });
  });

  it('exits 0 without a stack trace when the report was never produced (e.g. packaging crashed first)', () => {
    const { status, stdout } = run([path.join(os.tmpdir(), 'minerva-never-written-report.json')]);
    expect(status).toBe(0);
    expect(stdout).toContain('nothing to analyze');
  });
});
