/**
 * Time-to-first-paint of the packaged app, recorded as a trend (#2384).
 *
 * The app prints one line when its first window is shown, if launched with
 * `MINERVA_BOOT_TIMING=1` (`src/main/boot-timing.ts`):
 *
 *   [boot] first-paint trigger=ready-to-show uptimeMs=612
 *
 * The launcher watches for it from the moment it spawns the binary, so each
 * sample carries two numbers: the main process's own `uptimeMs`, and
 * `spawnToPaintMs` — spawn to the line arriving on the pipe, which also counts
 * exec, dyld and Electron's native startup before Node existed. The second is
 * the one a user feels; the first is the one that moves when JS loading does.
 *
 * Recorded, never asserted: `recordFirstPaint` appends to
 * `<outputDir>/first-paint.jsonl`, and `scripts/first-paint-report.mjs` puts
 * it in the job summary. A missing sample is reported there as a warning, not
 * a test failure — the smoke boot's job is "does it boot", and a flaky number
 * must never cost the e2e job its flake budget.
 */
import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import { test } from '@playwright/test';

/** Must match `markFirstPaint`'s output in `src/main/boot-timing.ts`. */
export const FIRST_PAINT_LINE = /\[boot\] first-paint trigger=(\S+) uptimeMs=(\d+)/;

export interface FirstPaintSample {
  trigger: string;
  uptimeMs: number;
  spawnToPaintMs: number;
}

/**
 * Start watching `child`'s output for the first-paint line. Call immediately
 * after `spawn`, before anything awaits, or an early line is missed.
 * `waitFor` resolves the sample, or `null` if none arrived in time or the
 * process exited first.
 */
export function watchFirstPaint(child: ChildProcess, spawnedAt: number): {
  waitFor(timeoutMs: number): Promise<FirstPaintSample | null>;
} {
  let seen = '';
  let sample: FirstPaintSample | null = null;
  const waiters = new Set<() => void>();
  const onData = (chunk: Buffer) => {
    if (sample) return;
    seen += chunk.toString();
    const m = FIRST_PAINT_LINE.exec(seen);
    if (!m) {
      // Only the tail can hold a line split across chunks.
      if (seen.length > 4096) seen = seen.slice(-512);
      return;
    }
    sample = {
      trigger: m[1]!,
      uptimeMs: Number(m[2]),
      spawnToPaintMs: Math.round(performance.now() - spawnedAt),
    };
    child.stdout?.off('data', onData);
    child.stderr?.off('data', onData);
    for (const w of waiters) w();
  };
  child.stdout?.on('data', onData);
  child.stderr?.on('data', onData);
  child.once('exit', () => { for (const w of waiters) w(); });

  return {
    async waitFor(timeoutMs) {
      if (!sample && child.exitCode === null && child.signalCode === null) {
        await new Promise<void>((resolve) => {
          const done = () => { clearTimeout(timer); waiters.delete(done); resolve(); };
          const timer = setTimeout(done, timeoutMs);
          waiters.add(done);
        });
      }
      return sample;
    },
  };
}

/**
 * Append this attempt's sample (or its absence) to
 * `<outputDir>/first-paint.jsonl`, and annotate the test with it.
 */
export function recordFirstPaint(sample: FirstPaintSample | null): void {
  const info = test.info();
  const row = {
    test: info.titlePath.slice(1).join(' › '),
    retry: info.retry,
    sample,
  };
  fs.mkdirSync(info.project.outputDir, { recursive: true });
  fs.appendFileSync(path.join(info.project.outputDir, 'first-paint.jsonl'), `${JSON.stringify(row)}\n`);
  info.annotations.push({
    type: 'first-paint',
    description: sample
      ? `${sample.spawnToPaintMs}ms spawn→paint, ${sample.uptimeMs}ms main uptime (${sample.trigger})`
      : 'no first-paint line from the app',
  });
}
