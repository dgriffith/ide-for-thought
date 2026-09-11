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
    // Vitest 5 (#1009): `bench()` now runs inside a wrapping `test()`, so the
    // test-level timeout applies to it too — including the per-scale seeding
    // that runs ahead of each `describe`/`test` (see e.g. full-index.bench.ts's
    // header comment), which dominates wall time far more than the measured
    // bench cycles themselves. `0` ("disabled") was tried first and did NOT
    // work here — bench-mode tests still hit a hardcoded ~60s ceiling
    // regardless (confirmed empirically: `--testTimeout=0` still failed at
    // exactly 60000ms, while an explicit finite value passed) — so this is a
    // real, generous number instead of "unlimited".
    testTimeout: 300_000,
    benchmark: {
      include: ['tests/**/*.bench.ts'],
    },
  },
});
