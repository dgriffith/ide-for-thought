/**
 * @vitest-environment node
 *
 * The release job asserts the tag server-side (#2245).
 *
 * `release-version.test.ts` covers the rule; this covers the thing the rule
 * was missing, which is that anything ran it. It existed only in
 * `tag-release.mjs` — a local convenience that `git tag -a v2.0.3 && git push
 * origin v2.0.3` never invokes, while the workflow's `push: tags: ['v*']`
 * trigger doesn't care how the tag was made.
 *
 * Every other invariant in that workflow is asserted on the runner: the DMG is
 * present, the signature verifies, Gatekeeper accepts it, the notarization
 * ticket staples, the DMG and ZIP are both there (#1639). This one was
 * asserted on a laptop, and its failure is silent at every checkpoint — a
 * release that is signed, notarized, published, and never offered to a single
 * installed app.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RELEASE_YML = path.join(ROOT, '.github', 'workflows', 'release.yml');

interface Step { name?: string; run?: string; uses?: string; if?: string; env?: Record<string, string> }
interface Job { steps?: Step[] }
interface Workflow { on?: unknown; jobs?: Record<string, Job> }

function release(): Workflow {
  return parse(fs.readFileSync(RELEASE_YML, 'utf-8')) as Workflow;
}

function steps(): Step[] {
  return Object.values(release().jobs ?? {}).flatMap((j) => j.steps ?? []);
}

const isTagCheck = (s: Step) => /check-release-tag/.test(s.run ?? '');

describe('release.yml verifies the pushed tag (#2245)', () => {
  it('parses and has steps — an empty scan would pass vacuously', () => {
    expect(steps().length).toBeGreaterThan(10);
  });

  it('runs the tag check', () => {
    const found = steps().filter(isTagCheck);
    expect(
      found.length,
      'release.yml must run scripts/check-release-tag.mjs — the tag is the one ' +
      'release input nothing else validates (#2245)',
    ).toBe(1);
  });

  it('runs it on tag pushes', () => {
    // Guarded rather than unconditional, unlike the lockfile gate (#2244):
    // `workflow_dispatch` on a branch has no tag to check, and failing there
    // would block a deliberate manual build.
    const step = steps().find(isTagCheck)!;
    expect(step.if).toContain("refs/tags/");
  });

  it('runs BEFORE the build, so a bad tag fails in seconds not minutes', () => {
    // A signed, notarized build of the wrong version costs ~15 minutes and
    // produces artifacts that must not be published.
    const all = steps();
    const checkAt = all.findIndex(isTagCheck);
    const buildAt = all.findIndex((s) => /electron-forge (make|package)|pnpm build/.test(s.run ?? ''));
    expect(checkAt).toBeGreaterThanOrEqual(0);
    if (buildAt >= 0) expect(checkAt).toBeLessThan(buildAt);
  });

  it('passes the tag as an env var, never interpolated into the shell', () => {
    // `github.ref_name` is attacker-influenced in principle — a tag name can
    // hold shell metacharacters. Interpolating `${{ github.ref_name }}`
    // directly into `run:` is the classic Actions script-injection shape, so
    // it arrives through `env:` and reaches the script as an argv.
    const step = steps().find(isTagCheck)!;
    expect(step.env?.TAG, 'the tag should come in through env:').toContain('github.ref_name');
    expect(
      step.run,
      'the tag must not be interpolated into the run: script',
    ).not.toContain('${{ github.ref_name }}');
  });

  it('the script it calls exists and is executable by node', () => {
    // A renamed script would leave the step green-looking in review and
    // failing at release time, which is the moment with the least slack.
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'check-release-tag.mjs'))).toBe(true);
  });
});

/**
 * Main CI passed for the released commit (#2371).
 *
 * The build re-runs lint and audit on the tagged commit but not the test
 * suite or e2e — those are main CI's, and nothing asked whether main CI
 * passed for this SHA. `release-ci-gate.test.ts` covers the rule; this pins
 * that release.yml runs it, early, and safely.
 */
describe('release.yml verifies main CI passed for the tagged commit (#2371)', () => {
  const GATE_JOB = 'ci-verdict';
  const isCiCheck = (s: Step) => /check-release-ci/.test(s.run ?? '');

  type Loose = Step & { 'continue-on-error'?: unknown };
  interface GateJob extends Job {
    needs?: string | string[];
    permissions?: Record<string, string>;
    'continue-on-error'?: unknown;
  }
  const jobs = () => (release().jobs ?? {}) as Record<string, GateJob>;
  const gateStep = (): Loose => jobs()[GATE_JOB]!.steps!.find(isCiCheck)!;

  it('runs the CI check exactly once, in its own job', () => {
    const found = Object.entries(jobs()).flatMap(([name, j]) =>
      (j.steps ?? []).filter(isCiCheck).map(() => name),
    );
    expect(found, 'release.yml must run scripts/check-release-ci.mjs (#2371)').toEqual([GATE_JOB]);
  });

  it('runs on tag pushes, and polls a still-running CI', () => {
    expect(gateStep().if).toContain('refs/tags/');
    // A tag pushed right after a merge races main CI (~12 min).
    expect(gateStep().run).toContain('--wait');
  });

  it('gates the build: build-macos needs it, and it comes first in the file', () => {
    // `needs:` is what actually orders jobs; file order keeps a flattened
    // step scan reading top to bottom.
    const needs = jobs()['build-macos']!.needs;
    expect([needs].flat()).toContain(GATE_JOB);
    const names = Object.keys(jobs());
    expect(names.indexOf(GATE_JOB)).toBeLessThan(names.indexOf('build-macos'));

    const all = steps();
    const checkAt = all.findIndex(isCiCheck);
    const buildAt = all.findIndex((s) => /electron-forge (make|package)|pnpm build/.test(s.run ?? ''));
    expect(checkAt).toBeGreaterThanOrEqual(0);
    expect(buildAt).toBeGreaterThanOrEqual(0);
    expect(checkAt).toBeLessThan(buildAt);
  });

  it('takes the SHA from the environment, never interpolated into the shell', () => {
    expect(gateStep().run).toContain('"$GITHUB_SHA"');
    expect(gateStep().run, 'no ${{ }} expression may reach the run: script').not.toMatch(/\$\{\{/);
  });

  it('authenticates gh with the job token', () => {
    expect(gateStep().env?.GH_TOKEN).toContain('github.token');
  });

  it('has no bypass switch', () => {
    // The remedy for a flaky red run is to rerun it to green; for a real one,
    // to fix it. A `continue-on-error` or a skip flag turns the gate back into
    // a log line.
    expect(jobs()[GATE_JOB]!['continue-on-error']).toBeUndefined();
    expect(gateStep()['continue-on-error']).toBeUndefined();
    expect(gateStep().run).not.toMatch(/--(skip|force|no-verify|allow)/);
  });

  it('the scripts it calls exist', () => {
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'check-release-ci.mjs'))).toBe(true);
    expect(fs.existsSync(path.join(ROOT, 'scripts', 'lib', 'release-ci-gate.mjs'))).toBe(true);
  });

  it('tag-release.mjs applies the same rule locally, and checks HEAD is on origin/main', () => {
    const src = fs.readFileSync(path.join(ROOT, 'scripts', 'tag-release.mjs'), 'utf-8');
    expect(src).toContain('./lib/release-ci-gate.mjs');
    expect(src).toMatch(/'--is-ancestor', head, 'origin\/main'/);
  });
});
