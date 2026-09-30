#!/usr/bin/env node
/**
 * Per-PR benchmark gate (#2386) — see `scripts/lib/pr-bench.mjs` for the method.
 *
 *   node scripts/pr-bench-compare.mjs --list
 *       Print the PR bench files, one per line (the workflow runs these).
 *
 *   node scripts/pr-bench-compare.mjs --base b1.json --head h1.json \
 *       [--base b2.json --head h2.json …] [--tolerance 1.5] [--summary out.md]
 *       Compare `vitest bench --reporter=json` reports from the PR's base and
 *       head. Prints the table, appends it to --summary (the workflow passes
 *       $GITHUB_STEP_SUMMARY), and exits 1 when any benchmark's head/base
 *       ratio exceeds the tolerance. A missing or unreadable report counts as a
 *       run with no results rather than crashing the gate.
 */
import { appendFileSync, readFileSync } from 'node:fs';
import { benchMeansFromReport } from './lib/bench-report.mjs';
import { comparePrBench, formatPrBench, PR_BENCH_FILES, PR_BENCH_TOLERANCE } from './lib/pr-bench.mjs';

const argv = process.argv.slice(2);
if (argv.includes('--list')) {
  process.stdout.write(PR_BENCH_FILES.join('\n') + '\n');
  process.exit(0);
}

const base = [];
const head = [];
let tolerance = PR_BENCH_TOLERANCE;
let summary = null;
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--base' || a === '--head') (a === '--base' ? base : head).push(argv[++i]);
  else if (a === '--tolerance') tolerance = Number(argv[++i]);
  else if (a === '--summary') summary = argv[++i];
  else { console.error(`pr-bench-compare: unknown argument ${a}`); process.exit(2); }
}
if (base.length === 0 || head.length === 0) {
  console.error('pr-bench-compare: need at least one --base and one --head report');
  process.exit(2);
}

function load(file) {
  try {
    return benchMeansFromReport(JSON.parse(readFileSync(file, 'utf-8')));
  } catch (err) {
    console.error(`pr-bench-compare: ${file}: ${err instanceof Error ? err.message : err} — counted as no results`);
    return new Map();
  }
}

const result = comparePrBench({ base: base.map(load), head: head.map(load), tolerance });
const md = formatPrBench(result);
console.log(md);
if (summary) appendFileSync(summary, md);
if (result.rows.length === 0) {
  console.error('pr-bench-compare: no benchmark ran on both sides — nothing was compared');
  process.exit(1);
}
process.exit(result.regressed.length ? 1 : 0);
