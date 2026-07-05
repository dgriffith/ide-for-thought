import { defineConfig } from 'vitest/config';

/**
 * Standalone config for `pnpm bench` (vitest benchmark mode, #1004).
 *
 * Kept apart from vitest.config.mts so the `*.bench.ts` files never run in the
 * gating `pnpm test` / coverage passes (those include only `*.test.ts`), and so
 * a bench run skips the svelte plugin the main config loads for component tests.
 *
 * Non-gating: run manually (`pnpm bench`) or from the scheduled `Bench` workflow
 * — never on PR CI (benchmarks are noisy on shared runners). The point is to
 * make scale regressions visible — graph index/query latency and embedding
 * throughput, the costs that grow with the knowledge base.
 */
export default defineConfig({
  test: {
    benchmark: {
      include: ['tests/**/*.bench.ts'],
    },
  },
});
