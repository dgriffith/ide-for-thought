/**
 * Time-to-first-paint, as a line the smoke boot can read (#2384).
 *
 * #2223 took the window off Electron's stock white by building it hidden and
 * showing it on the first paint signal, and #2229 holds the *structure* that
 * keeps startup fast (nothing awaited ahead of `createWindow`, heavy modules
 * loaded lazily). Neither says how long a real packaged boot takes, so a lazily
 * loaded module going eager again would pass every structural test and just
 * make the app slower to appear. This is the measurement half: `showWhenReady`
 * calls `markFirstPaint` from whichever of its triggers wins, and the packaged
 * smoke boot (`tests/e2e/smoke.spec.ts`) reads the line off stdout and records
 * it as a trend. Not a gate — CI runners vary too much for a threshold to mean
 * anything without history behind it.
 *
 * Env-gated and once per process: a normal launch prints nothing, and a second
 * window is not a boot.
 */
import { logger } from '../shared/logger';

/** Set to `1` to print the first-paint mark. Only the smoke boot sets it. */
export const BOOT_TIMING_ENV = 'MINERVA_BOOT_TIMING';

/** Which of `showWhenReady`'s triggers showed the first window. `timeout`
 *  means no paint signal arrived at all, so the number is the fallback timer's,
 *  not a paint. */
export type FirstPaintTrigger = 'ready-to-show' | 'did-finish-load' | 'did-fail-load' | 'timeout';

let marked = false;

/**
 * Print `first-paint trigger=<t> uptimeMs=<n>` once, when `MINERVA_BOOT_TIMING=1`.
 * `uptimeMs` is the main process's own clock (`process.uptime()`), so it
 * excludes exec/dyld time before Node started; the harness also measures from
 * spawn, which includes it. The line format is parsed by
 * `tests/e2e/helpers/first-paint.ts` — change both together.
 */
export function markFirstPaint(trigger: FirstPaintTrigger): void {
  if (marked || process.env[BOOT_TIMING_ENV] !== '1') return;
  marked = true;
  logger('boot').info(`first-paint trigger=${trigger} uptimeMs=${Math.round(process.uptime() * 1000)}`);
}

/** Test-only: forget that the mark was printed. */
export function _resetFirstPaintMarkForTests(): void {
  marked = false;
}
