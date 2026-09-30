/**
 * Read per-benchmark means out of a `vitest bench --reporter=json` report.
 *
 * Shared by `scripts/bench-check.mjs` (weekly, against the committed baseline)
 * and `scripts/pr-bench-compare.mjs` (per PR, base against head, #2386), so the
 * two gates can never disagree about what a report says.
 *
 * Vitest 5 (#1009) dropped `--outputJson`; a run is the standard test-result
 * shape instead. Each `test()` that calls `bench()` is one `assertionResults[]`
 * entry carrying a `benchmarks[]` array whose `tasks[]` hold the numbers, keyed
 * by the `bench()` call's own `name` (NOT the group/test title).
 * `latency.mean` is ms/op, `throughput.mean` is ops/sec.
 */

/**
 * @param {unknown} json a parsed vitest bench JSON report
 * @returns {Map<string, { mean: number, hz: number | undefined }>}
 */
export function benchMeansFromReport(json) {
  const map = new Map();
  const report = /** @type {any} */ (json);
  for (const result of report?.testResults ?? []) {
    for (const assertion of result.assertionResults ?? []) {
      for (const group of assertion.benchmarks ?? []) {
        for (const task of group.tasks ?? []) {
          const mean = task.latency?.mean;
          // A benchmark that errored (e.g. a setup race) reports no mean — skip
          // it rather than crash; callers report it as missing from the run.
          if (typeof mean !== 'number' || !Number.isFinite(mean)) continue;
          map.set(task.name, { mean, hz: task.throughput?.mean });
        }
      }
    }
  }
  return map;
}
