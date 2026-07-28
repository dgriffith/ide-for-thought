#!/usr/bin/env node
/**
 * Benchmark regression gate (#1099).
 *
 * `pnpm bench` prints numbers for a human to read in a job log — nothing
 * *asserts* that graph query / index latency hasn't regressed as the KB grows,
 * so a 3× scale cliff would sit in a Monday log nobody reads (finding H2). This
 * script closes that gap: it diffs a fresh benchmark run against a committed
 * baseline and exits non-zero when any benchmark regressed beyond a tolerance
 * envelope, or breached an absolute budget.
 *
 * Design (deliberately resistant to noisy-runner flapping):
 *   - Runs from the scheduled / manual `Bench` workflow, NOT per-PR — micro-
 *     benchmarks flap on shared runners, so gating a PR on them is a false-
 *     positive machine. Nightly baseline-diff catches real regressions without
 *     the flap.
 *   - Gates on the RATIO to a committed baseline (default 2×), not raw ms, so a
 *     slow cold runner shifts every number together and cancels out.
 *   - An optional per-benchmark `budgetMs` adds a hard absolute ceiling for the
 *     few latencies we want a scale envelope on (e.g. graph query at 5k notes).
 *
 * Usage:
 *   node scripts/bench-check.mjs --current <vitest-bench.json> [--baseline <f>]
 *        [--tolerance <factor>] [--update]
 *
 *   --current    Fresh `vitest bench --outputJson` result (required, except with
 *                --update where it's the source to snapshot).
 *   --baseline   Committed baseline (default tests/main/bench-baseline.json).
 *   --tolerance  Regression factor (default: baseline.tolerance, else 2.0). Also
 *                overridable via BENCH_TOLERANCE. current/baseline > tolerance ⇒ fail.
 *   --update     Refresh the baseline from --current (preserving tolerance +
 *                per-benchmark budgetMs) and exit 0. Run this to re-bless numbers.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const DEFAULT_BASELINE = 'tests/main/bench-baseline.json';
const DEFAULT_TOLERANCE = 2.0;

function parseArgs(argv) {
  const args = { baseline: DEFAULT_BASELINE, update: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--current') args.current = argv[++i];
    else if (a === '--baseline') args.baseline = argv[++i];
    else if (a === '--tolerance') args.tolerance = Number(argv[++i]);
    else if (a === '--update') args.update = true;
    else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

/** Flatten a vitest `--outputJson` report (files→groups→benchmarks) OR an
 *  already-flat baseline ({ benchmarks: [...] }) into name → {mean, hz, budgetMs}. */
function flatten(json) {
  const map = new Map();
  if (Array.isArray(json.benchmarks)) {
    for (const b of json.benchmarks) {
      map.set(b.name, { mean: b.mean, hz: b.hz, budgetMs: b.budgetMs ?? null, gate: b.gate !== false });
    }
    return map;
  }
  for (const file of json.files ?? []) {
    for (const group of file.groups ?? []) {
      for (const b of group.benchmarks ?? []) {
        // `mean` is ms/op, `hz` is ops/sec. Lower mean = faster. A benchmark
        // that errored (e.g. a setup race) reports no mean — skip it rather
        // than crash; the "missing from run" report below surfaces it.
        if (typeof b.mean !== 'number' || !Number.isFinite(b.mean)) continue;
        map.set(b.name, { mean: b.mean, hz: b.hz, budgetMs: null });
      }
    }
  }
  return map;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function fmt(ms) {
  return ms >= 1 ? `${ms.toFixed(2)}ms` : `${(ms * 1000).toFixed(1)}µs`;
}

const args = parseArgs(process.argv.slice(2));
if (!args.current) {
  console.error('bench-check: --current <vitest-bench.json> is required');
  process.exit(2);
}

const current = flatten(readJson(args.current));

// ── --update: snapshot current → baseline, keeping tolerance + budgets ──
if (args.update) {
  let prev = { tolerance: DEFAULT_TOLERANCE, benchmarks: [] };
  try {
    prev = readJson(args.baseline);
  } catch {
    /* first run — no baseline yet */
  }
  // Preserve hand-set budgetMs / gate flags across a re-bless — only the
  // measured mean/hz should move.
  const prevMeta = new Map((prev.benchmarks ?? []).map((b) => [b.name, { budgetMs: b.budgetMs ?? null, gate: b.gate }]));
  const benchmarks = [...current.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, { mean, hz }]) => {
      const meta = prevMeta.get(name) ?? {};
      const entry = { name, mean: Number(mean.toFixed(6)), hz: Number(hz.toFixed(2)), budgetMs: meta.budgetMs ?? null };
      if (meta.gate === false) entry.gate = false;
      return entry;
    });
  const out = {
    _comment:
      'Committed benchmark baseline (#1099). Regenerate on the macos-latest ' +
      'Bench runner with `pnpm bench:baseline` and commit the diff. `budgetMs` ' +
      'is an optional hard ceiling (ms) — set it by hand for scale-envelope gates.',
    tolerance: prev.tolerance ?? DEFAULT_TOLERANCE,
    benchmarks,
  };
  writeFileSync(args.baseline, JSON.stringify(out, null, 2) + '\n');
  console.log(`bench-check: wrote ${benchmarks.length} benchmarks to ${args.baseline}`);
  process.exit(0);
}

// ── compare current vs committed baseline ──
const baselineJson = readJson(args.baseline);
const baseline = flatten(baselineJson);
const tolerance =
  args.tolerance ??
  (process.env.BENCH_TOLERANCE ? Number(process.env.BENCH_TOLERANCE) : undefined) ??
  baselineJson.tolerance ??
  DEFAULT_TOLERANCE;

const regressions = [];
const budgetBreaches = [];
const missing = [];
const added = [];
const rows = [];

for (const [name, base] of baseline) {
  const cur = current.get(name);
  if (!cur) {
    missing.push(name);
    continue;
  }
  const ratio = cur.mean / base.mean;
  // Some benchmarks are inherently high-variance (e.g. building a 5k-note
  // rdflib graph from scratch is GC-dominated, ±200% run to run). Record them
  // for week-over-week diffing, but don't let their noise fail the gate.
  const gated = base.gate !== false;
  const regressed = gated && ratio > tolerance;
  const overBudget = gated && base.budgetMs != null && cur.mean > base.budgetMs;
  if (regressed) regressions.push({ name, ratio });
  if (overBudget) budgetBreaches.push({ name, mean: cur.mean, budgetMs: base.budgetMs });
  rows.push({
    name,
    base: base.mean,
    cur: cur.mean,
    ratio,
    flag: !gated ? 'tracked' : regressed ? 'REGRESSED' : overBudget ? 'OVER BUDGET' : ratio < 1 / tolerance ? 'faster' : 'ok',
  });
}
for (const name of current.keys()) {
  if (!baseline.has(name)) added.push(name);
}

// ── report ──
console.log(`\nBenchmark regression check — tolerance ${tolerance}× vs ${args.baseline}\n`);
const namePad = Math.max(4, ...rows.map((r) => r.name.length));
console.log(`${'name'.padEnd(namePad)}  ${'baseline'.padStart(10)}  ${'current'.padStart(10)}  ${'ratio'.padStart(7)}  status`);
for (const r of rows.sort((a, b) => b.ratio - a.ratio)) {
  console.log(
    `${r.name.padEnd(namePad)}  ${fmt(r.base).padStart(10)}  ${fmt(r.cur).padStart(10)}  ${(r.ratio.toFixed(2) + '×').padStart(7)}  ${r.flag}`,
  );
}

if (added.length) console.log(`\n⚠ ${added.length} new benchmark(s) not in baseline (run \`pnpm bench:baseline\`):\n  - ${added.join('\n  - ')}`);
if (missing.length) console.log(`\n⚠ ${missing.length} baseline benchmark(s) missing from this run:\n  - ${missing.join('\n  - ')}`);

if (regressions.length || budgetBreaches.length) {
  console.error('\n✗ Benchmark regression gate FAILED:');
  for (const r of regressions) console.error(`  - ${r.name}: ${r.ratio.toFixed(2)}× slower than baseline (> ${tolerance}×)`);
  for (const b of budgetBreaches) console.error(`  - ${b.name}: ${fmt(b.mean)} exceeds budget ${fmt(b.budgetMs)}`);
  process.exit(1);
}

console.log('\n✓ No benchmark regressed beyond tolerance.');
process.exit(0);
