#!/usr/bin/env node
/**
 * E2E flake report + budget (#1946, #2379).
 *
 * Playwright retries twice in CI (playwright.config.ts) so a single Electron
 * boot hiccup doesn't fail the job (#1097). This script reads Playwright's own
 * JSON report and:
 *
 *   - prints a table of every test that needed a retry, win or lose (#1946);
 *   - enforces the flake budget: more than `FLAKE_BUDGET` flaky tests in one
 *     run exits 1, naming them (#2379 — the number and the evidence behind it
 *     live in scripts/lib/e2e-flake-budget.mjs);
 *   - says why the Playwright step failed when it did — a test that failed
 *     every attempt, or an error outside any test such as a worker teardown
 *     timeout — so the flake table is never read as the cause of a red run;
 *   - names, for every failed attempt, the `test.step` it ended in and any
 *     hang probe or app kill the e2e helpers recorded on it, and raises a
 *     `::warning` per killed app (#2458);
 *   - appends all of it to $GITHUB_STEP_SUMMARY when set.
 *
 * The policy is here, in one tested module, rather than as Playwright flags:
 * `--fail-on-flaky-tests` is all-or-nothing (budget 0), which would defeat the
 * retries, and it would print nothing about which budget or why.
 *
 * Usage:
 *   node scripts/e2e-flake-report.mjs <playwright-report.json> [--max-flaky <n>]
 */
import { readFileSync, appendFileSync } from 'node:fs';
import { FLAKE_BUDGET, formatReport } from './lib/e2e-flake-budget.mjs';

function parseArgs(argv) {
  const args = { maxFlaky: FLAKE_BUDGET };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--max-flaky') {
      args.maxFlaky = Number(argv[++i]);
      if (!Number.isInteger(args.maxFlaky) || args.maxFlaky < 0) throw new Error(`--max-flaky needs a non-negative integer, got ${argv[i]}`);
    } else if (!args.report) args.report = a;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
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
  const { summary, body, verdict, ok, killedApps, repairedGates } = formatReport(JSON.parse(raw), args.maxFlaky);
  console.log(`\n${summary}\n\n${body}\n\n${verdict}\n`);
  // A killed app is never silent (#2458): each gets its own run annotation,
  // whether or not its test went on to pass on a retry.
  for (const k of killedApps) console.log(`::warning title=E2E app under test was killed::${k}`);
  for (const g of repairedGates) console.log(`::warning title=E2E launch lost Playwright's ready release (repaired)::${g}`);

  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `\n## ${summary}\n\n${body}\n\n\`\`\`\n${verdict}\n\`\`\`\n`);
  }

  if (!ok) {
    // `::error::` puts the reason on the run's annotations, not only in the log.
    console.log(`::error title=E2E flake budget exceeded::${verdict.split('\n')[0].replace(/^✗ /, '')}`);
    process.exit(1);
  }
  process.exit(0);
}
