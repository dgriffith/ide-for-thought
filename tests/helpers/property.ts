/**
 * Shared fast-check settings for the property tests in `tests/property/` (#2388).
 *
 * - `numRuns` is modest per property, so the whole directory stays a few
 *   seconds of CI. Each property states its own count; `FC_NUM_RUNS_SCALE`
 *   multiplies all of them for a deliberate soak run
 *   (`FC_NUM_RUNS_SCALE=50 pnpm test tests/property`).
 * - The seed is NOT fixed. Every run explores fresh inputs, so coverage
 *   accumulates across CI runs instead of re-checking the same N cases
 *   forever. On failure fast-check's reporter prints the seed, the replay
 *   path and the shrunk counterexample; `FC_SEED` + `FC_PATH` replay it:
 *   `FC_SEED=123 FC_PATH="4:1" pnpm test tests/property/<file>`.
 * - A failure's shrunk counterexample becomes an ordinary example test next to
 *   the fix (see the convention block in `untrusted-content.property.test.ts`).
 */
import type { Parameters } from 'fast-check';

function envInt(name: string): number | undefined {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return undefined;
  const n = Number(raw);
  return Number.isFinite(n) ? n : undefined;
}

/** fast-check parameters for one property: `numRuns` scaled, replay honoured. */
export function propertyParams<T>(numRuns: number, extra: Parameters<T> = {}): Parameters<T> {
  const scale = envInt('FC_NUM_RUNS_SCALE') ?? 1;
  const seed = envInt('FC_SEED');
  const replayPath = process.env.FC_PATH;
  return {
    numRuns: Math.max(1, Math.round(numRuns * scale)),
    ...(seed !== undefined ? { seed } : {}),
    ...(seed !== undefined && replayPath ? { path: replayPath } : {}),
    ...extra,
  };
}
