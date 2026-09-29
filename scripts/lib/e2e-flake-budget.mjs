/**
 * E2E flake budget (#2379) — the pure half of `scripts/e2e-flake-report.mjs`.
 *
 * Playwright retries each e2e test twice in CI (playwright.config.ts) so a
 * transient Electron-boot hiccup doesn't fail the job (#1097). #1946 made those
 * retries VISIBLE; this makes them COUNT: a run may absorb at most
 * `FLAKE_BUDGET` flaky tests, and one more fails the job, naming them.
 *
 * Why 1 — measured, not chosen (#2379, 105 ci.yml runs, 2026-09-23 → 09-29):
 *
 *  - Before the proposal-review / keyboard-journey specs landed: 0 flaky tests
 *    in 48 consecutive e2e runs.
 *  - After: 34 flaky results in 59 e2e attempts (reruns included) — 20 with
 *    one, 7 with two. Every one but one was the SAME race: a later
 *    announcement (almost always the seeded proposal's own "New proposal"
 *    arrival toast, flushed 300ms late) overwriting the approve/reject
 *    announcement in the single polite live region, in whichever of three
 *    specs happened to lose it that run. A budget of 1 would have
 *    failed all 7 two-flake runs, i.e. caught that defect on its first day.
 *  - The one unrelated flake (a11y › proposals panel, a 60s hang) was alone
 *    in its run. One isolated retry is what #1097's retries are for.
 *
 * So: ≤1 flaky test is the cost of booting Electron on a shared runner; 2+ in
 * one run has, every time it happened, been a real defect.
 *
 * What this does NOT decide: a test that fails every attempt, or an error
 * outside any test (e.g. "Worker teardown timeout" — the app under test never
 * quit), fails the Playwright step itself, before this script runs. Retries
 * cannot absorb those, and the verdict below says so rather than letting the
 * flake table read as the cause (#2379 found a run where it did).
 */

/** Flaky tests one run may absorb. See the header for the evidence. */
export const FLAKE_BUDGET = 1;

const ANSI = /\u001b\[[0-9;]*m/g;

/** Every test whose results array shows at least one retry attempt,
 *  regardless of whether it eventually passed. */
export function collectRetriedTests(json) {
  const out = [];
  const walk = (suite, titlePath) => {
    for (const spec of suite.specs ?? []) {
      const path = [...titlePath, spec.title].join(' › ');
      for (const test of spec.tests ?? []) {
        const results = test.results ?? [];
        if (results.length <= 1) continue;
        const finalStatus = results[results.length - 1]?.status ?? 'unknown';
        out.push({ title: path, attempts: results.length, finalStatus });
      }
    }
    for (const s of suite.suites ?? []) walk(s, [...titlePath, s.title]);
  };
  for (const s of json.suites ?? []) walk(s, [s.title]);
  return out;
}

/** Flaky = needed a retry and then passed. That is Playwright's own
 *  definition (`stats.flaky`); a retried test that never passed is a failure,
 *  not a flake, and it has already failed the Playwright step. */
export function collectFlakyTests(json) {
  return collectRetriedTests(json).filter((r) => r.finalStatus === 'passed');
}

/** Errors Playwright raised outside any test (`report.errors`) — worker
 *  teardown timeouts, global-setup failures. Each fails the run on its own,
 *  whatever the retries did. First line only, ANSI stripped. */
export function collectRunErrors(json) {
  return (json.errors ?? []).map((e) => String(e?.message ?? e ?? '').replace(ANSI, '').split('\n')[0].trim()).filter(Boolean);
}

/**
 * The verdict. `ok` is the budget alone — the only thing this script gates;
 * `playwrightFailed` explains a red Playwright step so nobody reads the flake
 * table as its cause.
 */
export function evaluateFlakeBudget(json, maxFlaky = FLAKE_BUDGET) {
  const flaky = collectFlakyTests(json);
  // Prefer Playwright's own count; the per-test walk supplies the names.
  const flakyCount = json.stats?.flaky ?? flaky.length;
  const failedCount = json.stats?.unexpected ?? 0;
  const runErrors = collectRunErrors(json);
  const ok = flakyCount <= maxFlaky;

  const lines = [];
  if (ok) {
    lines.push(`✓ within flake budget: ${flakyCount} flaky ≤ ${maxFlaky}`);
  } else {
    lines.push(`✗ flake budget exceeded: ${flakyCount} flaky > ${maxFlaky}`);
    for (const f of flaky) lines.push(`  - ${f.title} (passed on attempt ${f.attempts})`);
  }
  if (failedCount > 0) {
    lines.push(`✗ ${failedCount} test(s) failed on every attempt — the Playwright step already failed the job; retries cannot absorb this.`);
  }
  if (runErrors.length > 0) {
    lines.push(`✗ ${runErrors.length} error(s) outside any test failed the Playwright step (not a flake; retries cannot absorb this):`);
    for (const e of runErrors) lines.push(`  - ${e}`);
  }
  if (flakyCount > 0) {
    lines.push('Every flaky test above is a real race somewhere. Fix it or file it; re-running the job only removes it from the record.');
  }
  return { ok, flakyCount, maxFlaky, flaky, failedCount, runErrors, playwrightFailed: failedCount > 0 || runErrors.length > 0, verdict: lines.join('\n') };
}

export function formatReport(json, maxFlaky = FLAKE_BUDGET) {
  const retried = collectRetriedTests(json);
  const stats = json.stats ?? {};
  const summary = `E2E flake report — ${stats.expected ?? 0} passed, ${stats.unexpected ?? 0} failed, ${stats.flaky ?? 0} flaky, ${stats.skipped ?? 0} skipped`;
  const body =
    retried.length === 0
      ? 'No test needed a retry.'
      : ['| test | attempts | final |', '|---|---|---|', ...retried.map((r) => `| ${r.title} | ${r.attempts} | ${r.finalStatus} |`)].join('\n');
  const budget = evaluateFlakeBudget(json, maxFlaky);
  return { summary, body, retried, ...budget };
}
