/**
 * Types for `e2e-flake-budget.mjs` (#2379). The implementation stays plain
 * `.mjs` so `scripts/e2e-flake-report.mjs` runs on the CI runner without a
 * transpile step.
 */
export const FLAKE_BUDGET: number;

export interface RetriedTest {
  title: string;
  attempts: number;
  finalStatus: string;
}

/** The slice of Playwright's JSON reporter output this reads. */
export interface PlaywrightReport {
  suites?: unknown[];
  stats?: { expected?: number; unexpected?: number; flaky?: number; skipped?: number };
  errors?: ({ message?: string } | string)[];
}

export interface FlakeBudgetResult {
  ok: boolean;
  flakyCount: number;
  maxFlaky: number;
  flaky: RetriedTest[];
  failedCount: number;
  runErrors: string[];
  playwrightFailed: boolean;
  verdict: string;
}

export function collectRetriedTests(json: PlaywrightReport): RetriedTest[];
export function collectFlakyTests(json: PlaywrightReport): RetriedTest[];
export function collectRunErrors(json: PlaywrightReport): string[];
export function evaluateFlakeBudget(json: PlaywrightReport, maxFlaky?: number): FlakeBudgetResult;
export function formatReport(
  json: PlaywrightReport,
  maxFlaky?: number,
): FlakeBudgetResult & { summary: string; body: string; retried: RetriedTest[] };
