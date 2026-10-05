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

/** A diagnostic an e2e helper recorded on one attempt (#2458). */
export interface AttemptNote {
  type: string;
  text: string;
}

/** One attempt that failed, or carries a helper diagnostic (#2458). */
export interface AttemptDiagnostic {
  title: string;
  attempt: number;
  status: string;
  duration: number;
  step: { title: string; duration: number } | null;
  error: string;
  notes: AttemptNote[];
}

export const DIAGNOSTIC_ANNOTATIONS: string[];

export interface FlakeBudgetResult {
  ok: boolean;
  flakyCount: number;
  maxFlaky: number;
  flaky: RetriedTest[];
  failedCount: number;
  runErrors: string[];
  attempts: AttemptDiagnostic[];
  killedApps: string[];
  /** Launches whose lost Playwright ready-release the helper repaired (#2595). */
  repairedGates: string[];
  playwrightFailed: boolean;
  verdict: string;
}

export function collectRetriedTests(json: PlaywrightReport): RetriedTest[];
export function collectFlakyTests(json: PlaywrightReport): RetriedTest[];
export function collectRunErrors(json: PlaywrightReport): string[];
export function collectAttemptDiagnostics(json: PlaywrightReport): AttemptDiagnostic[];
export function evaluateFlakeBudget(json: PlaywrightReport, maxFlaky?: number): FlakeBudgetResult;
export function formatReport(
  json: PlaywrightReport,
  maxFlaky?: number,
): FlakeBudgetResult & { summary: string; body: string; retried: RetriedTest[] };
