#!/usr/bin/env node
/**
 * E2E flake visibility (#1946).
 *
 * Playwright retries twice in CI (playwright.config.ts) so a single Electron
 * boot hiccup doesn't fail the job — but nothing aggregated the "retry #N"
 * lines the `list` reporter prints, so a test that needed a retry on every
 * run was indistinguishable from one that always passed first try. This
 * script reads Playwright's own JSON report (which already tracks retries
 * per test and a `stats.flaky` count) and:
 *
 *   - prints a summary table of any test that needed a retry, win or lose
 *   - appends the same summary to $GITHUB_STEP_SUMMARY when set, so the rate
 *     is visible per-run in the Actions UI over time without needing a
 *     separate dashboard
 *   - exits non-zero only if flaky-test count exceeds --max-flaky
 *
 * Decision recorded (#1946): --max-flaky defaults to Infinity, i.e. a retry
 * does NOT fail the job today. Retries exist specifically so a transient
 * Electron-boot hiccup doesn't fail CI (#1097) — making any retry fail the
 * job would defeat that, and the actual flake rate isn't known yet (two
 * local runs weren't enough to measure it). This script's real job right now
 * is accumulating that history in the Actions run summaries; once several
 * weeks of runs show a stable baseline, revisit whether a real --max-flaky
 * budget (e.g. 0, or 1 per N runs) belongs in ci.yml.
 *
 * Usage:
 *   node scripts/e2e-flake-report.mjs <playwright-report.json> [--max-flaky <n>]
 */
import { readFileSync, appendFileSync } from 'node:fs';

function parseArgs(argv) {
  const args = { maxFlaky: Infinity };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-flaky') args.maxFlaky = Number(argv[++i]);
    else if (!args.report) args.report = a;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

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

export function formatReport(json) {
  const retried = collectRetriedTests(json);
  const stats = json.stats ?? {};
  const summary = `E2E flake report — ${stats.expected ?? 0} passed, ${stats.unexpected ?? 0} failed, ${stats.flaky ?? 0} flaky, ${stats.skipped ?? 0} skipped`;
  const body =
    retried.length === 0
      ? 'No test needed a retry.'
      : ['| test | attempts | final |', '|---|---|---|', ...retried.map((r) => `| ${r.title} | ${r.attempts} | ${r.finalStatus} |`)].join('\n');
  return { summary, body, flakyCount: stats.flaky ?? 0, retried };
}

// ── CLI entry point ──
if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args.report) {
    console.error('e2e-flake-report: a Playwright JSON report path is required');
    process.exit(2);
  }
  let raw;
  try {
    raw = readFileSync(args.report, 'utf-8');
  } catch {
    // The run may have failed before Playwright produced a report at all
    // (e.g. electron-forge packaging itself crashed) — that failure already
    // surfaced in the step before this one, so don't pile on with a stack
    // trace for a file that was never going to exist.
    console.log(`e2e-flake-report: no report at ${args.report} — nothing to analyze.`);
    process.exit(0);
  }
  const { summary, body, flakyCount } = formatReport(JSON.parse(raw));
  console.log(`\n${summary}\n\n${body}\n`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n## ${summary}\n\n${body}\n`);
  }

  if (flakyCount > args.maxFlaky) {
    console.error(`\n✗ ${flakyCount} flaky test(s) exceeds the budget of ${args.maxFlaky}.`);
    process.exit(1);
  }
  process.exit(0);
}
