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
 *   - it does NOT cover the loose `src/main/*.ts` modules. Several have per-file
 *     floors (`security.ts`, `privileged-sites.ts`, `auto-update.ts`); the rest
 *     don't, and requiring one per file would be a different and much noisier
 *     rule than the one this enforces;
 *   - it DOES catch the case it exists for: a new subsystem directory landing
 *     with nothing but the global backstop behind it.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

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
