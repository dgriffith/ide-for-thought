/**
 * @vitest-environment node
 *
 * A check that runs out-of-band ships its notification path (#2242).
 *
 * Every other detector in this repo — coverage floors, file-size budgets,
 * pattern ratchets, IPC registrar coverage, the architecture tests — runs
 * inside `pnpm test`, so it fails a PR in front of a human who is already
 * looking. `bench.yml` is the one check that runs outside the PR loop, and it
 * is the one that went unheard: the regression gate exited non-zero on **seven
 * consecutive scheduled runs** (2026-08-03 → 2026-09-14) while a real 3-3.8×
 * save-path regression shipped, because GitHub's only built-in signal for a
 * failing scheduled workflow is an email to the workflow file's last committer.
 *
 * That correlation is the design principle, not a coincidence. CI detected the
 * regression seven weeks before a human did; the defect was in the
 * notification path, not the gate.
 *
 * So: a workflow with an `on.schedule` trigger must have a step that runs on
 * failure. What that step does is its business — file an issue, post to a
 * webhook, page someone — but "exits non-zero into a log nobody opens" is not
 * a check, it is a record of something nobody read.
 *
 * Deliberately narrow. It does NOT cover `on.push` / `on.pull_request`
 * workflows: those fail visibly on a PR, which is the whole reason this rule
 * only bites out-of-band. `release.yml` runs on a tag push, with a human
 * watching the release they just cut.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW_DIR = path.join(ROOT, '.github', 'workflows');

interface Step { name?: string; uses?: string; if?: string }
interface Job { steps?: Step[]; permissions?: unknown }
interface Workflow { on?: unknown; jobs?: Record<string, Job> }

function workflows(): Array<{ file: string; doc: Workflow }> {
  return fs
    .readdirSync(WORKFLOW_DIR)
    .filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'))
    .map((f) => ({
      file: f,
      doc: parse(fs.readFileSync(path.join(WORKFLOW_DIR, f), 'utf-8')) as Workflow,
    }));
}

/**
 * True when the workflow runs on a timer.
 *
 * `on:` is the YAML 1.1 boolean `true` once parsed — a footgun worth naming
 * rather than silently handling, because reading `doc.on` returns undefined and
 * this test would then pass on everything.
 */
function isScheduled(doc: Workflow): boolean {
  const on = (doc as Record<string, unknown>)['on'] ?? (doc as Record<string, unknown>)['true'];
  if (on === null || typeof on !== 'object') return false;
  return 'schedule' in (on as Record<string, unknown>);
}

/** Steps that run when an earlier step failed. */
function failureSteps(doc: Workflow): Step[] {
  return Object.values(doc.jobs ?? {})
    .flatMap((job) => job.steps ?? [])
    .filter((step) => typeof step.if === 'string' && step.if.includes('failure()'));
}

describe('out-of-band checks notify someone (#2242)', () => {
  it('finds the workflows — an empty directory would pass vacuously', () => {
    const found = workflows();
    expect(found.length).toBeGreaterThanOrEqual(3);
    expect(found.map((w) => w.file)).toContain('bench.yml');
  });

  it('parses `on:` despite YAML 1.1 turning it into a boolean key', () => {
    // If this ever regresses, `isScheduled` returns false for everything and
    // the real assertion below becomes a no-op that reads like a guarantee.
    const bench = workflows().find((w) => w.file === 'bench.yml')!;
    expect(isScheduled(bench.doc)).toBe(true);
    const ci = workflows().find((w) => w.file === 'ci.yml');
    if (ci) expect(isScheduled(ci.doc)).toBe(false);
  });

  it('every scheduled workflow has a step that runs on failure', () => {
    const offenders = workflows()
      .filter((w) => isScheduled(w.doc))
      .filter((w) => failureSteps(w.doc).length === 0)
      .map((w) => w.file);

    if (offenders.length > 0) {
      expect.fail(
        `Scheduled workflow(s) with no failure notification:\n\n` +
        offenders.map((f) => `  .github/workflows/${f}`).join('\n') +
        `\n\nA scheduled run that fails reaches nobody — GitHub emails only the ` +
        `workflow file's last committer. \`bench.yml\` failed seven Mondays in a row ` +
        `that way while a real regression shipped (#2242). Add an \`if: failure()\` ` +
        `step that files or updates an issue, and give the job \`issues: write\`.`,
      );
    }
  });

  it('bench.yml files an issue rather than only annotating the run', () => {
    // Named separately so a regression says which capability was lost. An
    // `if: failure()` step that only ran `echo` would satisfy the rule above
    // and notify precisely nobody.
    const bench = workflows().find((w) => w.file === 'bench.yml')!;
    const steps = failureSteps(bench.doc);
    expect(steps.length).toBeGreaterThan(0);
    expect(steps.some((s) => String(s.uses ?? '').includes('github-script'))).toBe(true);

    const job = Object.values(bench.doc.jobs ?? {})[0]!;
    const perms = job.permissions as Record<string, string> | undefined;
    expect(perms?.issues, 'the notify step needs issues: write').toBe('write');
  });

  it('the gate output is captured, so the issue can say what regressed', () => {
    // `tee` without `pipefail` reports tee's exit status — the gate would go
    // green and the notification would never fire. Easy to lose in an edit.
    const raw = fs.readFileSync(path.join(WORKFLOW_DIR, 'bench.yml'), 'utf-8');
    expect(raw).toContain('bench-report.txt');
    expect(raw).toContain('set -o pipefail');
  });
});
