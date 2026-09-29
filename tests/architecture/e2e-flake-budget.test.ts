/**
 * @vitest-environment node
 *
 * The e2e flake budget is enforced, and enforced in one place (#2379).
 *
 * `scripts/e2e-flake-report.mjs` fails the e2e job when more than
 * `FLAKE_BUDGET` tests needed a retry. That only means something while four
 * pieces of wiring stay put, and each can be removed without any test noticing:
 *
 *  - ci.yml's e2e job runs the report on the file Playwright writes, with
 *    `if: always()` (a red Playwright step must still get its table and
 *    verdict), with no `continue-on-error` (which would make the budget a
 *    log line again — the #1946 state this replaced), and with no
 *    `--max-flaky` (the policy lives in the script, next to its evidence; a
 *    flag in the workflow is a second copy to drift).
 *  - Playwright's JSON reporter writes the path that step reads. Rename one
 *    side and the report finds no file, prints "nothing to analyze", and
 *    exits 0 — forever.
 *  - CI retries leave room for the budget: with fewer retries than the budget
 *    the budget can never be reached, and with 0 there is no flake to count.
 *  - `failOnFlakyTests` stays off. It is a budget of 0 in disguise, which
 *    defeats the retries that absorb Electron-boot hiccups (#1097), and it
 *    fails without saying which budget or why.
 *
 * And the diagnostics that make a flaky test worth counting (#2458): a hang
 * that retries absorb is only a finding if the failed attempt says where it
 * hung. So navigation is bounded (Playwright Test's default is no timeout),
 * CI keeps the trace of each test's first failing attempt, and the uploaded
 * artifact carries `test-results/`, where those traces are written.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { FLAKE_BUDGET } from '../../scripts/lib/e2e-flake-budget.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

interface Step { name?: string; run?: string; if?: string; uses?: string; with?: { path?: string }; 'continue-on-error'?: unknown }
interface Workflow { jobs?: Record<string, { steps?: Step[]; 'continue-on-error'?: unknown }> }

const ci = parse(fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf-8')) as Workflow;
const playwrightConfig = fs.readFileSync(path.join(ROOT, 'playwright.config.ts'), 'utf-8');

const e2e = ci.jobs?.e2e;
const reportStep = e2e?.steps?.find((s) => s.run?.includes('scripts/e2e-flake-report.mjs'));

describe('e2e flake budget wiring (#2379)', () => {
  it('ci.yml has an e2e job that runs the flake report', () => {
    expect(e2e, 'ci.yml must have an `e2e` job').toBeDefined();
    expect(reportStep, 'the e2e job must run scripts/e2e-flake-report.mjs').toBeDefined();
  });

  it('the report runs even after a red Playwright step', () => {
    expect(reportStep?.if).toBe('always()');
  });

  it('a budget breach fails the job (no continue-on-error on the step or the job)', () => {
    expect(reportStep?.['continue-on-error']).toBeUndefined();
    expect(e2e?.['continue-on-error']).toBeUndefined();
  });

  it('the budget comes from the script, not a workflow flag', () => {
    expect(reportStep?.run).not.toMatch(/--max-flaky/);
  });

  it('reads the file Playwright’s JSON reporter writes', () => {
    const out = /\['json',\s*\{\s*outputFile:\s*'([^']+)'/.exec(playwrightConfig)?.[1];
    expect(out, 'playwright.config.ts must configure the json reporter with an outputFile').toBeDefined();
    expect(reportStep?.run?.split(/\s+/)).toContain(out);
  });

  it('CI retries leave room for the budget', () => {
    const retries = /retries:\s*process\.env\.CI\s*\?\s*(\d+)\s*:/.exec(playwrightConfig)?.[1];
    expect(retries, 'playwright.config.ts must set CI retries as `process.env.CI ? n : 0`').toBeDefined();
    expect(Number(retries)).toBeGreaterThanOrEqual(1);
    expect(FLAKE_BUDGET).toBeGreaterThanOrEqual(1);
  });

  it('failOnFlakyTests stays off — the budget is the flake policy', () => {
    expect(playwrightConfig).not.toMatch(/failOnFlakyTests/);
    for (const s of e2e?.steps ?? []) expect(s.run ?? '').not.toMatch(/--fail-on-flaky-tests/);
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf-8')) as { scripts: Record<string, string> };
    expect(pkg.scripts['test:e2e']).not.toMatch(/--fail-on-flaky-tests/);
  });

  it('navigation is bounded — no reload can spend the whole test timeout in silence (#2458)', () => {
    const nav = /navigationTimeout:\s*([\d_]+)/.exec(playwrightConfig)?.[1];
    expect(nav, 'playwright.config.ts must set use.navigationTimeout').toBeDefined();
    const ms = Number(nav!.replace(/_/g, ''));
    expect(ms).toBeGreaterThan(0);
    const testTimeout = Number(/\btimeout:\s*([\d_]+)/.exec(playwrightConfig)?.[1]?.replace(/_/g, ''));
    expect(ms, 'a navigation bound at or above the test timeout bounds nothing').toBeLessThan(testTimeout);
  });

  it('CI keeps the trace of a first failing attempt, and uploads where it is written (#2458)', () => {
    expect(playwrightConfig).toMatch(/trace:\s*process\.env\.CI\s*\?\s*'retain-on-first-failure'/);
    const upload = e2e?.steps?.find((s) => s.uses?.startsWith('actions/upload-artifact@') && s.with?.path?.includes('playwright-report.json'));
    expect(upload, 'the e2e job must upload the Playwright report').toBeDefined();
    expect(upload?.if).toBe('always()');
    expect(upload?.with?.path?.split(/\s+/)).toContain('test-results/');
  });
});
