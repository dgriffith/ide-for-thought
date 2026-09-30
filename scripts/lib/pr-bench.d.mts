/**
 * Types for `pr-bench.mjs` (#2386). The implementation stays plain `.mjs` so
 * `scripts/pr-bench-compare.mjs` runs on the CI runner without a transpile step.
 */
export const PR_BENCH_TOLERANCE: number;
export const PR_BENCH_FILES: string[];

export interface PrBenchRow {
  name: string;
  base: number;
  head: number;
  ratio: number;
  spread: number;
  regressed: boolean;
}

export interface PrBenchResult {
  rows: PrBenchRow[];
  added: string[];
  missing: string[];
  tolerance: number;
  regressed: PrBenchRow[];
}

export function comparePrBench(input: {
  base: Map<string, { mean: number }>[];
  head: Map<string, { mean: number }>[];
  tolerance?: number;
}): PrBenchResult;

export function formatPrBench(result: PrBenchResult): string;
