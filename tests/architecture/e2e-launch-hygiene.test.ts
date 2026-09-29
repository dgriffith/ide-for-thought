/**
 * Every e2e spec boots Minerva through `tests/e2e/helpers/launch.ts` (#1928).
 *
 * The bug this ratchets against: `smoke.spec.ts`'s first test called
 * `electron.launch` with `args: [projectRoot]` and no `--user-data-dir`, so it
 * ran against the developer's real Electron profile — writing to `Preferences`
 * and `Session Storage` on the way out, and turning its own "a fresh launch
 * yields the Open Thoughtbase shell" premise into a race against session
 * restore that it happened to win. Eight sibling launch sites got it right.
 * The one that didn't was invisible: green in CI (empty profile) and green
 * locally (the assertion lands before restore completes), so nothing anywhere
 * reported the difference.
 *
 * A convention that eight of nine call sites follow is not a convention, it's a
 * coincidence. `launchMinerva` makes `userDataDir` a required parameter so
 * omitting it is a type error; this test closes the other route, where a new
 * spec reaches for `electron.launch` directly and never learns the helper
 * exists.
 *
 * It also holds the teardown half (#2458): specs close through `closeMinerva`
 * (bounded, then SIGKILL, reported), import the reaping `test` from
 * `helpers/test.ts`, and call the main-process seed hooks through their bounded
 * helpers rather than an unbounded inline `app.evaluate`.
 *
 * Deliberately a whole-file scan rather than a lint rule: the rule is about
 * *which* API a spec may reach for, which reads more clearly as one assertion
 * naming the reason than as an `eslint` `no-restricted-syntax` entry.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const E2E_DIR = path.resolve(__dirname, '..', 'e2e');
const HELPER = path.join(E2E_DIR, 'helpers', 'launch.ts');

function specFiles(): string[] {
  return fs.readdirSync(E2E_DIR)
    .filter((f) => f.endsWith('.spec.ts'))
    .map((f) => path.join(E2E_DIR, f));
}

describe('e2e launch hygiene (#1928)', () => {
  // Guards the scan itself: a glob that silently matched nothing would make
  // every assertion below pass vacuously.
  it('finds the e2e specs', () => {
    expect(specFiles().length).toBeGreaterThanOrEqual(5);
  });

  it('no spec calls electron.launch directly — they go through launchMinerva', () => {
    const offenders = specFiles().filter((file) => {
      const src = fs.readFileSync(file, 'utf8');
      // Ignore prose: only a real call, not the word in a comment.
      return /(?<!\/\/[^\n]*)\belectron\s*\.\s*launch\s*\(/.test(
        src.split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n'),
      );
    });

    expect(
      offenders.map((f) => path.basename(f)),
      'These specs launch Electron directly instead of via tests/e2e/helpers/launch.ts.\n' +
      'A direct launch can omit --user-data-dir, which means booting the developer\'s real\n' +
      'profile: the app restores their last project and the run writes back to it. That is\n' +
      'exactly how the smoke test came to assert the opposite of what it claimed (#1928).\n' +
      'Use `launchMinerva({ userDataDir })` — it requires the profile and filters the env.',
    ).toEqual([]);
  });

  // #2458: a wedged app hung `app.close()` forever, and a test that timed out
  // left its app for Playwright's worker teardown — which hung the same way and
  // failed the job with an error outside any test. `closeMinerva` bounds the
  // close and SIGKILLs loudly; the `test` in helpers/test.ts reaps whatever a
  // timed-out test left running. Both only help if specs actually use them.
  function code(file: string): string {
    return fs.readFileSync(file, 'utf8')
      .split('\n').filter((l) => !l.trim().startsWith('*') && !l.trim().startsWith('//')).join('\n');
  }
  const launching = () => specFiles().filter((f) => /\blaunchMinerva\s*\(/.test(code(f)));

  it('no spec closes the app with a bare close() — they use closeMinerva (#2458)', () => {
    expect(launching().length, 'the scan should find specs that launch Minerva').toBeGreaterThanOrEqual(5);
    const offenders = launching().filter((f) => /\bapp\s*\.\s*close\s*\(/.test(code(f)));
    expect(
      offenders.map((f) => path.basename(f)),
      '`app.close()` has no timeout: when the main process is wedged it never returns, and the\n' +
      'run fails with "Worker teardown timeout" outside any test (#2458). Use\n' +
      '`closeMinerva(app)` from tests/e2e/helpers/launch.ts — bounded, then SIGKILL, reported.',
    ).toEqual([]);
  });

  it('every spec that launches Minerva imports `test` from helpers/test (the post-test reaper) (#2458)', () => {
    const offenders = launching().filter((f) => !/import\s*\{[^}]*\btest\b[^}]*\}\s*from\s*'\.\/helpers\/test'/.test(code(f)));
    expect(
      offenders.map((f) => path.basename(f)),
      'A test that times out never reaches its own `finally`, so its app is only closed if the\n' +
      "auto fixture in tests/e2e/helpers/test.ts runs. Import `test` (and `expect`) from './helpers/test'.",
    ).toEqual([]);
  });

  it('no spec calls the MINERVA_E2E hooks inline — the bounded helpers do (#2458)', () => {
    const offenders = specFiles().filter((f) => /__minervaE2E/.test(code(f)));
    expect(
      offenders.map((f) => path.basename(f)),
      'An inline `app.evaluate(() => __minervaE2E.…)` runs in the main process with no timeout.\n' +
      'Use `seedProposal(app)` / `ingestSource(app)` from tests/e2e/helpers/launch.ts, which bound\n' +
      'the call and probe the main process when it overruns.',
    ).toEqual([]);
  });

  it('the helper forces --user-data-dir onto every launch', () => {
    const src = fs.readFileSync(HELPER, 'utf8');
    // One construction site for the flag, unconditional — not a caller-supplied
    // arg the packaged/dev branches could each forget.
    expect(src).toMatch(/const userDataArg = `--user-data-dir=\$\{userDataDir\}`/);
    expect(src.match(/userDataArg/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });

  it('the helper filters credentials out of the forwarded environment', async () => {
    const { scrubbedEnv } = await import('../e2e/helpers/launch');
    const before = { ...process.env };
    try {
      process.env.ANTHROPIC_API_KEY = 'sk-should-not-reach-the-app';
      process.env.GH_TOKEN = 'ghp_should-not-reach-the-app';
      process.env.AWS_ACCESS_KEY_ID = 'AKIA-should-not-reach-the-app';
      process.env.PATH = before.PATH ?? '/usr/bin';

      const env = scrubbedEnv();
      expect(env.ANTHROPIC_API_KEY).toBeUndefined();
      expect(env.GH_TOKEN).toBeUndefined();
      expect(env.AWS_ACCESS_KEY_ID).toBeUndefined();
      // …while still handing over what the app genuinely needs to boot.
      expect(env.PATH).toBeDefined();
    } finally {
      // process.env is worker-global; restore so the deletions don't leak into
      // other files sharing this worker.
      for (const k of ['ANTHROPIC_API_KEY', 'GH_TOKEN', 'AWS_ACCESS_KEY_ID']) {
        if (before[k] === undefined) delete process.env[k];
        else process.env[k] = before[k];
      }
    }
  });
});
