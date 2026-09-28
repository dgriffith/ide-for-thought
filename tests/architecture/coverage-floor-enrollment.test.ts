/**
 * @vitest-environment node
 *
 * Every main-process subsystem is enrolled in a coverage floor (#2239, epic #2241).
 *
 * CLAUDE.md's LLM/Graph review checklist asks whether a new module "is covered
 * by a `vitest.config.mts` threshold". It was a good question with no way to
 * answer it, and the answer turned out to be *no* for fifteen subsystems —
 * `mcp-client` (a hand-rolled MCP protocol implementation with a full OAuth 2.1
 * flow, 2,977 lines), `skills`, `types`, `clipper` and a dozen more, all
 * sitting under the 45%-lines global backstop alone.
 *
 * That backstop is a net against a wholesale collapse across the entire
 * `include` set. It is not a per-area gate: a subsystem can fall from 99% to
 * 50% without moving the aggregate enough to trip it. #2239 measured all
 * fifteen and gave each a floor; this test is what stops the sixteenth arriving
 * without one.
 *
 * ── What it checks ──────────────────────────────────────────────────────────
 * Every directory directly under `src/main/` that contains at least one `.ts`
 * file is matched by some threshold key in `vitest.config.mts`. That's a low
 * bar on purpose, and worth being precise about:
 *
 *   - it does NOT check that the floor is well-calibrated, or even non-trivial.
 *     A subsystem enrolled at `lines: 1` passes here. Calibration is a judgement
 *     made when the floor is set (measure, then sit 3-5 points below) and it
 *     can't be automated without re-running coverage, which this test does not;
 *   - it does NOT check nested subtrees. `src/main/llm/tools/**` and
 *     `src/main/mcp-client/oauth/**` have their own floors *because an
 *     aggregate cannot fail on account of one file*, which is a real and
 *     recurring shape — but deciding which subtree earns that treatment is a
 *     judgement about trust boundaries, not something to demand everywhere;
 *   - it DOES catch the case it exists for: a new subsystem directory landing
 *     with nothing but the global backstop behind it.
 *
 * ── Loose `src/main/*.ts` modules (#2368) ───────────────────────────────────
 * The directory rule above left every file sitting directly in `src/main/`
 * invisible, and those are not small leftovers: `menu.ts` (985 lines, the
 * native command surface #2233 is about) was at 36% lines and
 * `window-manager.ts` at 61%, both with nothing behind them but the 45%
 * backstop an aggregate of ~37k lines will never trip on their account.
 *
 * So the second half of this test requires an exact per-file threshold key for
 * every loose module of at least LOOSE_FILE_MIN_LINES lines. Requiring one for
 * *every* loose file would be the noisy rule the old header rejected — below
 * the line, the loose files are type re-exports, the `ipc.ts` orchestrator and
 * config shims of a few dozen lines, where a per-file floor is bookkeeping and
 * one added branch swings the ratio 5 points. 150 was chosen over a rounder
 * 200 on purpose: it is what caught `maintenance-commands.ts` (172 lines, then
 * 0%), the one implementation both the menu and its registrar call — tested
 * directly and given a floor in #2407.
 *
 * KNOWN_UNENROLLED is the backlog of files over the line that have no floor,
 * each with a reason. It may only shrink: a listed file that gains an entry,
 * drops under the line or is deleted fails until it is removed from the list.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const VITEST_CONFIG = 'vitest.config.mts';
const MAIN_DIR = path.join(ROOT, 'src', 'main');

/**
 * Threshold keys from the `thresholds` block, e.g. `src/main/graph/**` and
 * `src/main/ipc/helpers.ts`.
 *
 * Lexical, like the parsers in `tests/helpers/renderer-api-surface.ts` and the
 * ratchets in `pattern-ratchets.test.ts` — and, like those, it throws when its
 * anchor is missing rather than returning an empty set, so a reformat that
 * defeats the match fails loudly instead of passing vacuously.
 */
function thresholdKeys(): string[] {
  const cfg = readFileSync(path.join(ROOT, VITEST_CONFIG), 'utf-8');
  const start = cfg.indexOf('thresholds: {');
  if (start < 0) {
    throw new Error(`No \`thresholds: {\` block found in ${VITEST_CONFIG} — did it get renamed?`);
  }
  // Quoted keys followed by `: {` — the per-glob/per-file entries. The bare
  // `statements: 45` style globals in the same block carry no quotes.
  return [...cfg.slice(start).matchAll(/'([^']+)':\s*\{/g)].map((m) => m[1]!);
}

/** Directories directly under `src/main/` holding at least one `.ts` file. */
function mainSubsystems(): string[] {
  return readdirSync(MAIN_DIR, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .filter((e) => hasTsFile(path.join(MAIN_DIR, e.name)))
    .map((e) => e.name)
    .sort();
}

function hasTsFile(dir: string): boolean {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (hasTsFile(path.join(dir, entry.name))) return true;
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      return true;
    }
  }
  return false;
}

/** Whether any threshold key would match files under `src/main/<name>/`. */
function isEnrolled(name: string, keys: string[]): boolean {
  const prefix = `src/main/${name}/`;
  return keys.some((key) => key.startsWith(prefix) || key === `${prefix}**`);
}

describe('coverage-floor enrollment (#2239)', () => {
  it('reads a non-trivial threshold list — a broken parse would pass vacuously', () => {
    const keys = thresholdKeys();
    expect(keys.length).toBeGreaterThan(20);
    expect(keys).toContain('src/main/graph/**');
    expect(keys).toContain('src/renderer/**');
  });

  it('finds the subsystems it is meant to police', () => {
    const subsystems = mainSubsystems();
    expect(subsystems.length).toBeGreaterThan(15);
    expect(subsystems).toContain('mcp-client');
  });

  it('every src/main subsystem has a coverage floor of its own', () => {
    const keys = thresholdKeys();
    const unenrolled = mainSubsystems().filter((name) => !isEnrolled(name, keys));
    expect(
      unenrolled,
      'Subsystem(s) under src/main/ with no coverage floor, so only the 45%-lines ' +
        'global backstop stands behind them:\n' +
        unenrolled.map((n) => `  src/main/${n}/`).join('\n') +
        '\n\nRun `pnpm coverage`, read the measured numbers for the directory, and add a ' +
        "`'src/main/<name>/**'` entry to `thresholds` in vitest.config.mts sitting 3-5 points " +
        'below them (8-10 if it is a single file, where one addition moves the whole ' +
        'aggregate). Record the measured numbers in the comment above the entry, the way ' +
        'every existing one does — the next person to touch it needs to know whether the ' +
        'floor is close to the real number or far below it.',
    ).toEqual([]);
  });
});

/** A loose `src/main/*.ts` module at or over this many lines needs its own floor. */
const LOOSE_FILE_MIN_LINES = 150;

/**
 * Loose modules over the line with no per-file floor (#2368). Shrink-only.
 * Measured 0% lines at 2026-09-27, so a floor today would be `lines: 0`,
 * which records nothing; the entry is the record instead.
 * (`maintenance-commands.ts` left the list in #2407.)
 */
const KNOWN_UNENROLLED: Readonly<Record<string, string>> = {
  // The Electron entry point. Importing it runs `app.whenReady()` and builds
  // windows, so no unit test loads it; its one real invariant (nothing awaited
  // ahead of `createWindow`) is held structurally by
  // `startup-window-not-gated.test.ts` rather than by line execution.
  'main.ts':
    'Electron entry point; importing it boots the app. Guarded structurally by startup-window-not-gated.test.ts.',
};

function lineCount(file: string): number {
  return readFileSync(file, 'utf-8').split('\n').length;
}

/** Loose `.ts` modules directly under `src/main/`, with their line counts. */
function looseMainFiles(): Array<{ name: string; lines: number }> {
  return readdirSync(MAIN_DIR, { withFileTypes: true })
    .filter((e) => e.isFile() && e.name.endsWith('.ts') && !e.name.endsWith('.d.ts'))
    .map((e) => ({ name: e.name, lines: lineCount(path.join(MAIN_DIR, e.name)) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

describe('coverage-floor enrollment: loose src/main files (#2368)', () => {
  const keys = new Set(thresholdKeys());
  const isFileEnrolled = (name: string) => keys.has(`src/main/${name}`);

  it('finds the loose files it is meant to police', () => {
    const big = looseMainFiles().filter((f) => f.lines >= LOOSE_FILE_MIN_LINES).map((f) => f.name);
    expect(big).toContain('menu.ts');
    expect(big).toContain('window-manager.ts');
  });

  it(`every loose src/main module of ${LOOSE_FILE_MIN_LINES}+ lines has a per-file floor`, () => {
    const unenrolled = looseMainFiles()
      .filter((f) => f.lines >= LOOSE_FILE_MIN_LINES)
      .filter((f) => !isFileEnrolled(f.name) && !(f.name in KNOWN_UNENROLLED));
    expect(
      unenrolled.map((f) => `src/main/${f.name} (${f.lines} lines)`),
      `Loose module(s) of ${LOOSE_FILE_MIN_LINES}+ lines under src/main/ with no per-file coverage ` +
        'floor, so only the 45%-lines global backstop stands behind them.\n\n' +
        "Run `pnpm coverage`, read the file's measured numbers, and add a `'src/main/<file>.ts'` " +
        'entry to `thresholds` in vitest.config.mts ~8-10 points below them, recording the ' +
        'measured numbers in the comment above it. Adding the file to KNOWN_UNENROLLED instead ' +
        'is a legitimate move only with a reason in the diff.',
    ).toEqual([]);
  });

  it('KNOWN_UNENROLLED only shrinks — entries that no longer need to be there fail', () => {
    const byName = new Map(looseMainFiles().map((f) => [f.name, f.lines]));
    const stale = Object.keys(KNOWN_UNENROLLED).flatMap((name) => {
      const lines = byName.get(name);
      if (lines === undefined) return [`${name}: no longer exists`];
      if (lines < LOOSE_FILE_MIN_LINES) return [`${name}: now ${lines} lines, under the line`];
      if (isFileEnrolled(name)) return [`${name}: now has a per-file floor`];
      return [];
    });
    expect(
      stale,
      'Delete these from KNOWN_UNENROLLED in this file so the ratchet holds the new ground.',
    ).toEqual([]);
  });
});

/**
 * The floors above only mean something if CI runs them — on the PR, before
 * the merge (#2359, then #2432).
 *
 * `pnpm coverage` is the only thing that evaluates `thresholds`. #2359 moved it
 * to pushes on main to cut PR latency, and #2432 showed the cost: a PR merged
 * green, dropped a file under its floor, and main went red for three commits —
 * which blocks releases (#2371). It now runs as its own parallel, required
 * `coverage` job on both events. Ways that silently regresses, all pinned here:
 *
 *   - the step gains an `if:` (or its job gains one) that skips pull_request
 *     — the floors go back to being a post-merge verdict;
 *   - the step disappears, or only runs on pull_request — main commits stop
 *     getting a coverage verdict at all;
 *   - the job stops being a required check — a red floor no longer blocks the
 *     merge, which is the same post-merge verdict by another route.
 */
describe('coverage floors are enforced in CI on PRs and on main (#2359, #2432)', () => {
  type Step = { name?: string; if?: string; run?: string };
  type Job = { if?: string; steps?: Step[] };
  const ci = () =>
    parse(readFileSync(path.join(ROOT, '.github', 'workflows', 'ci.yml'), 'utf-8')) as {
      on: { push?: { branches?: string[] }; pull_request?: unknown };
      jobs: Record<string, Job>;
    };
  const coverageSteps = () =>
    Object.entries(ci().jobs).flatMap(([job, j]) =>
      (j.steps ?? [])
        .filter((s) => /\bpnpm coverage\b/.test(s.run ?? ''))
        .map((s) => ({ job, jobIf: j.if, step: s })),
    );

  it('ci.yml runs on both pull_request and push to main', () => {
    const on = ci().on;
    expect(on.push?.branches, 'ci.yml must run on push to main').toContain('main');
    expect('pull_request' in on, 'ci.yml must run on pull_request').toBe(true);
  });

  it('the `coverage` job runs `pnpm coverage` with no condition on the event', () => {
    const found = coverageSteps();
    expect(found.length, 'no ci.yml step runs `pnpm coverage` — no floor is enforced').toBeGreaterThan(0);
    const unconditional = found.filter(
      ({ jobIf, step }) => (jobIf ?? '').trim() === '' && (step.if ?? '').trim() === '',
    );
    expect(
      unconditional.map(({ job }) => job),
      '`pnpm coverage` must run on every event — an `if:` on the step or its job that skips ' +
        'pull_request turns the floors back into a post-merge verdict (#2432), and one that ' +
        'skips push leaves main commits with none.',
    ).toContain('coverage');
  });

  it('the coverage job is a required check, so a floor breach blocks the merge', () => {
    type Ruleset = {
      rules: Array<{ type: string; parameters?: { required_status_checks?: Array<{ context: string }> } }>;
    };
    const ruleset = JSON.parse(
      readFileSync(path.join(ROOT, '.github', 'rulesets', 'main.json'), 'utf-8'),
    ) as Ruleset;
    const contexts = ruleset.rules
      .filter((r) => r.type === 'required_status_checks')
      .flatMap((r) => r.parameters?.required_status_checks ?? [])
      .map((c) => c.context);
    expect(contexts).toContain('coverage');
  });
});
