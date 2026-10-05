/**
 * @vitest-environment node
 *
 * main's committed ruleset agrees with the CI it requires (#2353).
 *
 * `.github/rulesets/main.json` requires named status checks before a PR can
 * merge. A required check is matched by NAME against what a workflow job
 * reports, and nothing on GitHub's side validates that the name exists. So the
 * realistic failure is not a loosened ruleset — `pnpm check:ruleset` covers
 * drift in the live settings — it is a renamed job in `ci.yml`: the old
 * context never reports again, stays "Expected — waiting for status" forever,
 * and blocks every PR in the repository until someone with admin notices.
 *
 * The opposite direction matters too: a new PR job that isn't required is a
 * gate that can be red at merge time, which is exactly what #2353 closed
 * (#2159-#2161 merged with a red e2e).
 *
 * Offline on purpose: this reads the committed file and the workflow, never
 * the API, so it runs in `pnpm test` like every other ratchet.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const RULESET = path.join(ROOT, '.github', 'rulesets', 'main.json');
const CI = path.join(ROOT, '.github', 'workflows', 'ci.yml');

/** The GitHub Actions app — `gh api apps/github-actions --jq .id`. */
const GITHUB_ACTIONS_APP_ID = 15368;

/**
 * Jobs in ci.yml that run on pull_request but are deliberately NOT required.
 * Each needs a reason. The four main PR jobs all gate the merge (`coverage`
 * joined in #2432's follow-up, when the floors moved onto PRs).
 */
const NOT_REQUIRED: Record<string, string> = {
  'x64 smoke boot (non-blocking)':
    'An early warning for #962 (x64 builds), which Minerva does not ship: runs on main pushes ' +
    'and only on PRs labelled x64-smoke, and is continue-on-error by design (#2387). ' +
    'Requiring it would block every PR on a check that usually never reports.',
  'security scan (advisory)':
    'Electronegativity + Semgrep against a baseline (#2570). Advisory while the baseline settles: a new ' +
    'finding is a ::warning and a summary row, and continue-on-error keeps it out of the merge gate. ' +
    'Promote it to required (and drop this entry) once it has run clean for a while.',
};

interface Check { context: string; integration_id?: number }
interface Rule { type: string; parameters?: Record<string, unknown> }
interface Ruleset {
  enforcement: string;
  conditions: { ref_name: { include: string[]; exclude: string[] } };
  rules: Rule[];
  bypass_actors: Array<{ actor_id: number; actor_type: string; bypass_mode: string }>;
}
interface Job { name?: string }
interface Workflow { on: Record<string, unknown> | string | string[]; jobs: Record<string, Job> }

const ruleset = JSON.parse(fs.readFileSync(RULESET, 'utf-8')) as Ruleset;
const ci = parse(fs.readFileSync(CI, 'utf-8')) as Workflow;

const statusRule = ruleset.rules.find((r) => r.type === 'required_status_checks');
const required = (statusRule?.parameters?.required_status_checks ?? []) as Check[];

/** The check-run name a job reports: its `name:` if set, else its id. */
const reportedName = (id: string, job: Job) => job.name ?? id;

function triggers(on: Workflow['on']): string[] {
  if (typeof on === 'string') return [on];
  if (Array.isArray(on)) return on;
  return Object.keys(on);
}

describe('main ruleset ↔ ci.yml (#2353)', () => {
  it('targets the default branch and is enforced', () => {
    expect(ruleset.enforcement).toBe('active');
    expect(ruleset.conditions.ref_name.include).toEqual(['~DEFAULT_BRANCH']);
  });

  it('requires at least one check — an empty list would pass everything below vacuously', () => {
    expect(required.length).toBeGreaterThan(0);
  });

  it('every required check is a job ci.yml actually reports', () => {
    const reported = new Set(
      Object.entries(ci.jobs).flatMap(([id, job]) => [id, reportedName(id, job)]),
    );
    const orphaned = required.map((c) => c.context).filter((c) => !reported.has(c));
    expect(
      orphaned,
      `Required check(s) with no matching job in .github/workflows/ci.yml: ${orphaned.join(', ')}.\n\n` +
        'A required context that never reports blocks EVERY pull request ("Expected — waiting ' +
        'for status to be reported"), and GitHub does not validate the name. If you renamed a ' +
        'job, rename the context in .github/rulesets/main.json in the same PR and re-apply it ' +
        '(see CLAUDE.md, "main is protected by a committed ruleset").',
    ).toEqual([]);
  });

  it('every required check is pinned to the GitHub Actions app', () => {
    // Without the integration id, any app (or a PAT with statuses:write) that
    // posts a status with the same name satisfies the requirement.
    const unpinned = required.filter((c) => c.integration_id !== GITHUB_ACTIONS_APP_ID);
    expect(unpinned.map((c) => c.context)).toEqual([]);
  });

  it('ci.yml runs on pull_request, or none of its checks could ever report on a PR', () => {
    expect(triggers(ci.on)).toContain('pull_request');
  });

  it('every pull_request job in ci.yml is required, or exempted with a reason', () => {
    const requiredNames = new Set(required.map((c) => c.context));
    // ci.yml's `pull_request` trigger is workflow-wide, so every job in it
    // runs on a PR. (A job-level `if:` that skipped PRs would still be counted
    // here, which is the conservative direction: such a job belongs in
    // NOT_REQUIRED with its reason, not silently out of scope.)
    const ungated = Object.entries(ci.jobs)
      .map(([id, job]) => reportedName(id, job))
      .filter((name) => !requiredNames.has(name) && !(name in NOT_REQUIRED));
    expect(
      ungated,
      `ci.yml job(s) that run on pull requests but don't gate the merge: ${ungated.join(', ')}.\n\n` +
        'Either add the job to required_status_checks in .github/rulesets/main.json (and ' +
        're-apply it), or add it to NOT_REQUIRED in this test with a reason.',
    ).toEqual([]);
  });

  it('an exempted job cannot fail the run either — non-blocking means both', () => {
    const blocking = Object.entries(ci.jobs)
      .filter(([id, job]) => reportedName(id, job) in NOT_REQUIRED)
      .filter(([, job]) => (job as { 'continue-on-error'?: unknown })['continue-on-error'] !== true)
      .map(([id]) => id);
    // A red non-required job would still turn main's run red, and release.yml
    // refuses a SHA whose main CI run wasn't a success (#2371).
    expect(blocking).toEqual([]);
  });

  it('the exemption list names only real jobs', () => {
    const names = new Set(Object.entries(ci.jobs).map(([id, job]) => reportedName(id, job)));
    expect(Object.keys(NOT_REQUIRED).filter((n) => !names.has(n))).toEqual([]);
  });

  it('requires branches to be up to date before merging', () => {
    // Two individually-green PRs can combine into a red main (#2348); strict
    // mode makes the second one re-run CI on top of the first.
    expect(statusRule?.parameters?.strict_required_status_checks_policy).toBe(true);
  });

  it('forbids deleting and force-pushing main', () => {
    const types = ruleset.rules.map((r) => r.type);
    expect(types).toContain('deletion');
    expect(types).toContain('non_fast_forward');
  });

  it('no bypass is silent — an override is only ever a deliberate PR merge', () => {
    const always = ruleset.bypass_actors.filter((a) => a.bypass_mode !== 'pull_request');
    expect(
      always,
      'A bypass_mode other than "pull_request" lets that actor push straight to main with no ' +
        'check run and no PR to show it. The emergency path is `gh pr merge --admin`.',
    ).toEqual([]);
  });
});
