/**
 * @vitest-environment node
 *
 * The lockfile/manifest gate, and the cache-key identity it depends on (#2244).
 *
 * `pnpm install --frozen-lockfile` is the only thing in the pipeline that
 * asserts `pnpm-lock.yaml` still matches `package.json` — and it ran behind
 * `if: cache-hit != 'true'`, while the cache key hashed the lockfile but not
 * the manifest. So a version-range edit in `package.json` with a stale
 * lockfile left the key unchanged, skipped the install, and reported green
 * against dependencies that don't match the manifest. The drift then surfaced
 * on the next contributor's cold clone, which is the worst place for it
 * precisely because CI was green.
 *
 * Two properties are pinned here, because both are the kind that decay
 * silently in a YAML file nobody re-reads:
 *
 *   1. **Every job that installs dependencies verifies the lockfile first, and
 *      does it unconditionally.** An `if:` on this step re-creates the bug in
 *      a form that looks fixed.
 *   2. **The three cache keys stay byte-identical.** `ci.yml` and
 *      `release.yml` deliberately share one warm `node_modules` cache (#1638,
 *      #663). Nothing fails when they drift — the workflows just quietly stop
 *      sharing and every run pays a cold install, which is invisible until
 *      someone reads the timings.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');

interface Step { name?: string; uses?: string; run?: string; if?: string; with?: Record<string, string> }
interface Job { steps?: Step[] }
interface Workflow { jobs?: Record<string, Job> }

function workflow(file: string): Workflow {
  return parse(fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf-8')) as Workflow;
}

/** Every (file, job, steps) triple across the workflows. */
function allJobs(): Array<{ file: string; job: string; steps: Step[] }> {
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .flatMap((file) =>
      Object.entries(workflow(file).jobs ?? {}).map(([job, j]) => ({
        file,
        job,
        steps: j.steps ?? [],
      })),
    );
}

const isInstall = (s: Step) => /pnpm install/.test(s.run ?? '') && !/--lockfile-only/.test(s.run ?? '');
const isVerify = (s: Step) => /--frozen-lockfile/.test(s.run ?? '') && /--lockfile-only/.test(s.run ?? '');

/**
 * An install that always runs IS the assertion — `--frozen-lockfile` fails on
 * a drifted manifest by itself. The gap #2244 fixed is specifically an install
 * behind `if: cache-hit`.
 *
 * No job is in that shape today: `bench.yml` was, until #2247 gave it a
 * `node_modules` cache and its install became conditional. This test caught
 * that in the same commit and it grew a verify step. Kept because the rule is
 * about the shape, not about which jobs happen to have it right now.
 */
const isUnconditionalFrozenInstall = (s: Step) =>
  isInstall(s) && /--frozen-lockfile/.test(s.run ?? '') && s.if === undefined;
const isNodeModulesCache = (s: Step) =>
  String(s.uses ?? '').startsWith('actions/cache') && (s.with?.path ?? '').trim() === 'node_modules';

describe('every installing job verifies the lockfile first (#2244)', () => {
  it('finds the jobs — an empty scan would pass vacuously', () => {
    const installing = allJobs().filter((j) => j.steps.some(isInstall));
    // All four install behind a cache check. #2244's issue named two of them;
    // `ci.yml`'s e2e job had the same conditional shape and was missed, and
    // `bench.yml` joined them in #2247 when it gained a cache. Listed so a
    // future reader doesn't re-derive this.
    expect(installing.map((j) => `${j.file}:${j.job}`).sort()).toEqual([
      'bench.yml:bench',
      'ci.yml:e2e',
      'ci.yml:lint-and-test',
      'release.yml:build-macos',
    ]);
  });

  it('has a verification step in each job whose install is conditional', () => {
    const missing = allJobs()
      .filter((j) => j.steps.some(isInstall))
      // An always-run `--frozen-lockfile` install is already the assertion.
      .filter((j) => !j.steps.some(isUnconditionalFrozenInstall))
      .filter((j) => !j.steps.some(isVerify))
      .map((j) => `${j.file}:${j.job}`);

    if (missing.length > 0) {
      expect.fail(
        `Job(s) that install dependencies without verifying the lockfile:\n\n` +
        missing.map((m) => `  ${m}`).join('\n') +
        `\n\nAdd \`pnpm install --frozen-lockfile --lockfile-only\` before the install. ` +
        `The install itself runs only on a cache miss, and the key does not hash ` +
        `package.json, so it is not a gate (#2244).`,
      );
    }
  });

  it('runs the verification UNCONDITIONALLY', () => {
    // The whole bug in one property. A verification step behind `if:` looks
    // like a fix in a diff and is not one.
    const conditional = allJobs()
      .flatMap((j) => j.steps.filter(isVerify).map((s) => ({ ...j, s })))
      .filter((x) => typeof x.s.if === 'string')
      .map((x) => `${x.file}:${x.job} (if: ${x.s.if})`);
    expect(conditional, 'the lockfile check must not depend on cache state').toEqual([]);
  });

  it('verifies BEFORE installing, so a drifted manifest fails fast', () => {
    for (const { file, job, steps } of allJobs()) {
      const verifyAt = steps.findIndex(isVerify);
      const installAt = steps.findIndex(isInstall);
      if (verifyAt === -1 || installAt === -1) continue;
      expect(verifyAt, `${file}:${job} verifies after it installs`).toBeLessThan(installAt);
    }
  });
});

describe('the shared node_modules cache key stays identical (#1638, #663)', () => {
  it('uses one key across every job', () => {
    // Drift here fails nothing — the workflows just stop sharing a warm cache
    // and quietly pay a cold install every run. That is exactly the kind of
    // regression that needs a test rather than a comment, and the comments do
    // ask for it: "Change both together or the sharing silently stops."
    const keys = allJobs()
      .flatMap((j) => j.steps.filter(isNodeModulesCache).map((s) => ({
        where: `${j.file}:${j.job}`,
        key: (s.with?.key ?? '').trim(),
      })));

    expect(keys.length).toBeGreaterThanOrEqual(3);
    const distinct = [...new Set(keys.map((k) => k.key))];
    expect(
      distinct.length,
      `node_modules cache keys diverged, so the jobs no longer share a warm cache:\n` +
      keys.map((k) => `  ${k.where}\n    ${k.key}`).join('\n'),
    ).toBe(1);
  });

  it('still keys on the lockfile and Node version', () => {
    // If the key stops hashing the lockfile, a dependency bump reuses a stale
    // tree — a different and worse failure than the one #2244 fixed.
    const key = allJobs()
      .flatMap((j) => j.steps.filter(isNodeModulesCache))
      .map((s) => s.with?.key ?? '')[0]!;
    expect(key).toContain("hashFiles('pnpm-lock.yaml')");
    expect(key).toContain("hashFiles('.nvmrc')");
  });
});

/**
 * Every workflow serializes its own runs (#2247).
 *
 * `bench.yml` was the only one without a `concurrency:` group. That mattered
 * more there than anywhere else: two overlapping runs — easy during a
 * re-blessing session, where you dispatch, look at the numbers, and dispatch
 * again — would benchmark each other's CPU contention, corrupting the output
 * of the one workflow whose entire product is a measurement.
 *
 * The `cancel-in-progress` VALUE is deliberately not asserted to one setting:
 * `ci.yml` cancels (superseded PR pushes are waste), `release.yml` and
 * `bench.yml` do not (a half-notarized release and a half-finished benchmark
 * are both worse than a slow one). What's asserted is that each workflow has
 * made the choice.
 */
describe('every workflow has a concurrency group (#2247)', () => {
  const docs = () =>
    fs
      .readdirSync(WORKFLOW_DIR)
      .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
      .map((file) => ({
        file,
        doc: parse(fs.readFileSync(path.join(WORKFLOW_DIR, file), 'utf-8')) as {
          concurrency?: { group?: string; 'cancel-in-progress'?: boolean };
        },
      }));

  it('finds the workflows — an empty scan would pass vacuously', () => {
    expect(docs().length).toBeGreaterThanOrEqual(3);
  });

  it('each declares one', () => {
    const missing = docs().filter((w) => !w.doc.concurrency?.group).map((w) => w.file);
    expect(
      missing,
      'a workflow with no concurrency group lets two runs of the same ref overlap',
    ).toEqual([]);
  });

  it('each makes an explicit cancel-in-progress choice', () => {
    // Omitting it defaults to false, which is right for two of the three — but
    // defaulting is not deciding, and the reasoning differs per workflow.
    const implicit = docs()
      .filter((w) => typeof w.doc.concurrency?.['cancel-in-progress'] !== 'boolean')
      .map((w) => w.file);
    expect(implicit).toEqual([]);
  });

  it('bench does NOT cancel in progress', () => {
    // Named on its own because it is the one where cancelling is actively
    // wrong: a partial benchmark yields no usable number, so a cancel wastes
    // the whole run rather than saving anything.
    const bench = docs().find((w) => w.file === 'bench.yml')!;
    expect(bench.doc.concurrency?.['cancel-in-progress']).toBe(false);
  });
});
