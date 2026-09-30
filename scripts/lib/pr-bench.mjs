/**
 * Per-PR benchmark comparison (#2386): the PR's head against its base, measured
 * on ONE runner in ONE job.
 *
 * The weekly gate (`bench-check.mjs`) compares a run against the committed
 * baseline, which is right once a week and wrong per PR: runner speed alone
 * moves every number ~1.4-1.5x between otherwise identical runs (#2331, and
 * the #2385 blessing runs), so a baseline comparison on a PR would flap. Here
 * both sides share the runner, so its speed cancels out of the ratio.
 *
 * The job runs the sides interleaved — base, head, base, head — and each side
 * is scored by its BEST (lowest) mean across its runs. Noise on a shared runner
 * only ever adds time, so the minimum is the estimate least polluted by it, and
 * interleaving keeps a slow patch of the runner from landing on one side only.
 */

/**
 * Default regression threshold: head/base above this can fail the check.
 *
 * Measured, not chosen. A dry run of the whole pipeline with IDENTICAL code on
 * both sides (base = head = main @ d9c53f71, locally, 2026-09-30) put the nine
 * ratios between 0.76x and 1.70x — the sub-2ms cold-rebuild bench at 500 notes
 * alone reached 1.70x on noise, and would have failed a PR that changed
 * nothing at the first threshold tried (1.5x). 2.0 clears that noise ceiling
 * and is still far below the 3-3.8x save-path regression this exists for
 * (#2242). A ratio also has to clear the overlap test in `comparePrBench`.
 */
export const PR_BENCH_TOLERANCE = 2.0;

/** The bench files the PR job runs: the fast graph + save-path set (~30s
 *  locally), which covers the code the path filter watches. The slow ones
 *  (full index, persist + query, health checks) stay weekly-only. */
export const PR_BENCH_FILES = [
  'tests/main/graph/graph-index.bench.ts',
  'tests/main/graph/n3-cache.bench.ts',
  'tests/main/graph/n3-cold-rebuild.bench.ts',
  'tests/main/notebase/write-pipeline.bench.ts',
];

/**
 * @param {{ base: Map<string, { mean: number }>[], head: Map<string, { mean: number }>[], tolerance?: number }} input
 *   one name → mean map per run, per side
 */
export function comparePrBench({ base, head, tolerance = PR_BENCH_TOLERANCE }) {
  const best = (runs, name) => {
    const means = runs.map((r) => r.get(name)?.mean).filter((m) => typeof m === 'number');
    // Score from whichever runs produced a number: one errored run shouldn't
    // drop a benchmark from the comparison.
    return means.length > 0
      ? { best: Math.min(...means), worst: Math.max(...means), spread: Math.max(...means) / Math.min(...means) }
      : null;
  };
  const names = new Set([...base.flatMap((r) => [...r.keys()]), ...head.flatMap((r) => [...r.keys()])]);
  const rows = [];
  const added = [];
  const missing = [];
  for (const name of [...names].sort()) {
    const b = best(base, name);
    const h = best(head, name);
    if (!b && h) { added.push(name); continue; }
    if (b && !h) { missing.push(name); continue; }
    if (!b || !h) continue; // absent or errored on both sides
    const ratio = h.best / b.best;
    // Two conditions, both required. The ratio of bests past the tolerance, AND
    // no overlap: even the head's fastest run is slower than the base's slowest.
    // A real regression clears both easily (a 3x one isn't close); runner noise,
    // whose runs interleave, fails the second even when a lucky base run makes
    // the first look bad.
    const separated = h.best > b.worst;
    rows.push({ name, base: b.best, head: h.best, ratio, spread: Math.max(b.spread, h.spread), regressed: ratio > tolerance && separated });
  }
  return { rows, added, missing, tolerance, regressed: rows.filter((r) => r.regressed) };
}

const fmt = (ms) => (ms >= 1 ? `${ms.toFixed(2)} ms` : `${(ms * 1000).toFixed(1)} µs`);

/** Markdown for the job summary. */
export function formatPrBench(result) {
  const lines = [];
  const verdict = result.regressed.length
    ? `**${result.regressed.length} benchmark(s) slower than ${result.tolerance}× the PR's base.**`
    : `No benchmark slower than ${result.tolerance}× the PR's base.`;
  lines.push('### PR bench: head vs base, same runner', '', verdict, '');
  lines.push('| benchmark | base | head | head/base | noise |', '|---|---:|---:|---:|---:|');
  for (const r of [...result.rows].sort((a, b) => b.ratio - a.ratio)) {
    const mark = r.regressed ? ' ❌' : '';
    lines.push(`| ${r.name} | ${fmt(r.base)} | ${fmt(r.head)} | ${r.ratio.toFixed(2)}×${mark} | ${r.spread.toFixed(2)}× |`);
  }
  lines.push('', '_Each side is its best of the interleaved runs; **noise** is the larger ' +
    'max/min spread of either side\'s runs. A benchmark fails only when the ratio is past the ' +
    'tolerance AND every head run is slower than every base run._');
  if (result.added.length) lines.push('', `New in this PR (no base to compare): ${result.added.map((n) => `\`${n}\``).join(', ')}`);
  if (result.missing.length) lines.push('', `On the base but not this PR: ${result.missing.map((n) => `\`${n}\``).join(', ')}`);
  return lines.join('\n') + '\n';
}
