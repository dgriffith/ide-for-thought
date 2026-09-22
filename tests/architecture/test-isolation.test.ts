/**
 * @vitest-environment node
 *
 * Test files stay isolated from each other (#2248).
 *
 * Vitest prints this at the end of every local run:
 *
 *   Isolate  754 workers spawned · ~172ms startup each
 *            at least ~14.01s faster with isolate: false
 *
 * It is an inviting suggestion and it is wrong for this suite. These tests are
 * genuinely filesystem- and process-stateful: chokidar watchers, DuckDB
 * handles, Python kernels, a real temp project per test, and module-level
 * `createProjectStore` singletons that live for a worker's lifetime. Dropping
 * isolation makes every one of those leak between files, and the failures that
 * produces are order-dependent and near-impossible to attribute — the worst
 * kind of flake to inherit in exchange for ~14 seconds of a ~9-minute run.
 *
 * This is not a claim that the current settings are optimal forever. It is a
 * claim that turning isolation off is a decision, not a speed-up, and should
 * arrive with the analysis rather than from following a hint. If that analysis
 * ever happens, update this test in the same PR — that is the whole point of
 * it failing.
 *
 * The wider trade-off this belongs to — `pnpm coverage` being ~71% of the PR
 * critical path, and why sharding was deferred — is recorded at the top of
 * `vitest.config.mts`'s `test:` block.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

/**
 * Line comments stripped, so prose about a setting isn't mistaken for the
 * setting. The config below explains at length why `isolate: false` is wrong
 * here — and the first version of this test failed on its own documentation.
 */
function stripComments(source: string): string {
  return source
    .split('\n')
    .map((line) => line.replace(/^\s*\/\/.*$/, ''))
    .join('\n');
}

/** The vitest configs, as declared code rather than as text. */
function configs(): Array<{ file: string; source: string }> {
  return ['vitest.config.mts', 'vitest.bench.config.ts']
    .filter((f) => fs.existsSync(path.join(ROOT, f)))
    .map((file) => ({
      file,
      source: stripComments(fs.readFileSync(path.join(ROOT, file), 'utf-8')),
    }));
}

/** The same files unstripped, for assertions about the documentation itself. */
function rawSource(file: string): string {
  return fs.readFileSync(path.join(ROOT, file), 'utf-8');
}

describe('vitest isolation (#2248)', () => {
  it('finds the configs — an empty scan would pass vacuously', () => {
    const found = configs();
    expect(found.length).toBeGreaterThanOrEqual(1);
    expect(found.map((c) => c.file)).toContain('vitest.config.mts');
  });

  it('no config turns isolation off', () => {
    const offenders = configs()
      .filter((c) => /isolate\s*:\s*false/.test(c.source))
      .map((c) => c.file);

    if (offenders.length > 0) {
      expect.fail(
        `isolate: false in ${offenders.join(', ')}.\n\n` +
        `This suite shares real filesystem and process state between tests — chokidar ` +
        `watchers, DuckDB handles, Python kernels, temp projects, and module-level ` +
        `createProjectStore singletons. Without isolation those leak across files and ` +
        `produce order-dependent failures nobody can attribute, in exchange for ~14s of ` +
        `a ~9-minute run (#2248). If this is deliberate and analysed, update this test ` +
        `in the same PR and say what changed.`,
      );
    }
  });

  it('does not disable file parallelism either', () => {
    // The mirror-image mistake: `fileParallelism: false` runs every file in one
    // worker sequentially. It fixes cross-file leakage by making the suite
    // enormously slower, which is the opposite trade to the one above and
    // equally worth arriving at on purpose.
    const offenders = configs()
      .filter((c) => /fileParallelism\s*:\s*false/.test(c.source))
      .map((c) => c.file);
    expect(offenders).toEqual([]);
  });

  it('the reasoning is recorded where someone would change it', () => {
    // A bare assertion with the argument only in a test file is half a rule:
    // the person tempted by vitest's hint is looking at the config, not here.
    const main = rawSource('vitest.config.mts');
    expect(main).toContain('#2248');
    expect(main).toMatch(/isolate/);
  });
});
