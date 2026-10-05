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
 * Every failed attempt is also described (#2458): the `test.step` it ended in,
 * its first error line, and any diagnostic the e2e helpers recorded on it — a
 * `hang` (a bounded call that overran, with a probe of whether the main process
 * still answered) or an `app-killed` (the app under test would not quit and was
 * SIGKILLed). A flaky test is only half a finding without the step that ate
 * its time; the #2458 hang had none, and "Test timeout of 60000ms exceeded" was
 * all the report could say.
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

/** Annotation types the e2e helpers push onto an attempt (tests/e2e/helpers). */
export const DIAGNOSTIC_ANNOTATIONS = ['hang', 'app-killed', 'ready-gate-repaired'];

const firstLine = (text) => String(text ?? '').replace(ANSI, '').split('\n')[0].trim();

/** The step an attempt ended in: the deepest `test.step` carrying an error. A
 *  timed-out test marks the step it was stuck in, so this is where the time
 *  went. Null when the failure was outside every named step. */
function endingStep(steps, trail = []) {
  for (const s of steps ?? []) {
    if (!s.error) continue;
    const path = [...trail, s.title];
    return endingStep(s.steps, path) ?? { title: path.join(' › '), duration: s.duration ?? 0 };
  }
  return null;
}

/** The attempt's own failure, ahead of an app-killed soft failure that the
 *  teardown may have recorded first. */
function primaryError(r) {
  const messages = (r.errors ?? []).map((e) => e?.message).filter(Boolean);
  if (messages.length === 0 && r.error?.message) messages.push(r.error.message);
  const own = messages.find((m) => !/app did not quit within/.test(m));
  return firstLine(own ?? messages[0]);
}

/**
 * Every attempt that did not pass, or that carries a helper diagnostic, with
 * the step it ended in (#2458). A passing attempt with an `app-killed` note
 * can't normally exist — the kill fails the attempt — but it is listed if it
 * does, since a silent kill is exactly what this is here to prevent.
 */
export function collectAttemptDiagnostics(json) {
  const out = [];
  const walk = (suite, titlePath) => {
    for (const spec of suite.specs ?? []) {
      const title = [...titlePath, spec.title].join(' › ');
      for (const test of spec.tests ?? []) {
        for (const r of test.results ?? []) {
          const notes = (r.annotations ?? [])
            .filter((a) => DIAGNOSTIC_ANNOTATIONS.includes(a?.type))
            .map((a) => ({ type: a.type, text: String(a.description ?? '').replace(ANSI, '').trim() }));
          if (r.status === 'passed' && notes.length === 0) continue;
          if (r.status === 'skipped') continue;
          const error = primaryError(r);
          out.push({ title, attempt: (r.retry ?? 0) + 1, status: r.status ?? 'unknown', duration: r.duration ?? 0, step: endingStep(r.steps), error, notes });
        }
      }
    }
    for (const s of suite.suites ?? []) walk(s, [...titlePath, s.title]);
  };
  for (const s of json.suites ?? []) walk(s, [s.title]);
  return out;
}

const secs = (ms) => `${(ms / 1000).toFixed(1)}s`;

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
  const attempts = collectAttemptDiagnostics(json);
  const killedApps = attempts.flatMap((a) => a.notes.filter((n) => n.type === 'app-killed').map((n) => firstLine(n.text)));
  // Launches whose lost Playwright ready-release the helper repaired (#2595):
  // not a failure, but never silent, so a rising count is visible.
  const repairedGates = attempts.flatMap((a) => a.notes.filter((n) => n.type === 'ready-gate-repaired').map((n) => `${a.title} — ${firstLine(n.text)}`));
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
  if (killedApps.length > 0) {
    lines.push(`✗ ${killedApps.length} app(s) under test would not quit and were killed — a wedged app, not a slow one (#2458):`);
    for (const k of killedApps) lines.push(`  - ${k}`);
  }
  if (repairedGates.length > 0) {
    lines.push(`⚠ ${repairedGates.length} launch(es) lost Playwright's ready release and were repaired by the helper (#2595):`);
    for (const g of repairedGates) lines.push(`  - ${g}`);
  }
  if (attempts.length > 0) {
    lines.push(`Failed attempts — where each one ended (#2458):`);
    for (const a of attempts) {
      const where = a.step ? ` in step "${a.step.title}" (${secs(a.step.duration)})` : ' (not inside a named step)';
      lines.push(`  - ${a.title} — attempt ${a.attempt} ${a.status} after ${secs(a.duration)}${where}`);
      if (a.error) lines.push(`      ${a.error}`);
      for (const n of a.notes) for (const l of `${n.type}: ${n.text}`.split('\n')) lines.push(`      ${l}`);
    }
  }
  if (flakyCount > 0) {
    lines.push('Every flaky test above is a real race somewhere. Fix it or file it; re-running the job only removes it from the record.');
  }
  return { ok, flakyCount, maxFlaky, flaky, failedCount, runErrors, attempts, killedApps, repairedGates, playwrightFailed: failedCount > 0 || runErrors.length > 0, verdict: lines.join('\n') };
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
