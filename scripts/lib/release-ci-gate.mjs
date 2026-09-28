/**
 * One definition of "main CI passed for the SHA being released" (#2371).
 *
 * The rule: the most recent `ci.yml` run for that exact commit, triggered by a
 * `push` to `main`, has `status: completed` and `conclusion: success`.
 * Everything else is refused, and each refusal says which case it is:
 *
 *   - **no run** — the commit isn't on main, or ci.yml never ran for it.
 *   - **completed, not success** (failure, cancelled, timed_out, …) — named,
 *     with the run URL.
 *   - **not completed yet** (queued, in_progress, waiting, …) — "pending".
 *     The local script refuses immediately; the runner polls until it
 *     completes (capped), then applies the verdict.
 *
 * A **rerun that went green counts**. A rerun doesn't create a new run — it
 * bumps `run_attempt` on the same one, and the run's `status`/`conclusion`
 * describe its latest attempt. Checked against the API rather than assumed:
 * run 36352501835 reads `run_attempt: 2, conclusion: success` while
 * `/runs/36352501835/attempts/1` reads `conclusion: failure`. So a flaky red
 * main run has a remedy that isn't a bypass: rerun it.
 *
 * There is deliberately **no bypass flag**. The remedy for a flaky red run is
 * to rerun it to green; the remedy for a real red run is to fix it.
 *
 * Same shape as `release-version.mjs` (#2245): pure, `{ ok }`-returning, and
 * shared by `tag-release.mjs` (local, before the tag exists) and
 * `check-release-ci.mjs` (release.yml, on the pushed ref) — because the local
 * check alone is walked straight past by `git tag && git push`.
 */
import { execFileSync } from 'node:child_process';

/** The workflow whose main-branch verdict a release depends on. */
export const CI_WORKFLOW = 'ci.yml';
export const MAIN_BRANCH = 'main';

export const FULL_SHA_RE = /^[0-9a-f]{40}$/;

const remedy = (run) =>
  'There is no bypass: if the failure is a flake (or the run was cancelled), rerun it ' +
  `to green (\`gh run rerun ${run.id ?? '<id>'} --failed\`); if it is real, fix it on ` +
  'main and release the fix.';

/**
 * The runs that can vouch for `sha`: ci.yml, on a push to main, for exactly
 * this commit. The API query already filters on all three; this re-applies
 * the filter so a loosened query (or a fixture) can't smuggle a PR run in —
 * a PR run is CI on a merge ref, not on the commit that ships.
 */
export function relevantRuns(runs, sha) {
  return (runs ?? []).filter(
    (r) =>
      r &&
      r.head_sha === sha &&
      r.event === 'push' &&
      r.head_branch === MAIN_BRANCH,
  );
}

/**
 * The most recent run. Normally there is exactly one per main commit; a second
 * appears only if the same SHA is pushed to main again. Ordered by creation,
 * with the run id (monotonic) as the tiebreak.
 */
export function latestRun(runs) {
  return [...runs].sort((a, b) => {
    const t = Date.parse(b.created_at ?? 0) - Date.parse(a.created_at ?? 0);
    return t !== 0 && !Number.isNaN(t) ? t : (b.id ?? 0) - (a.id ?? 0);
  })[0];
}

/**
 * Judge `sha` from the workflow runs the API returned for it.
 *
 * Returns one of:
 *   { ok: true,  state: 'success', run, message }
 *   { ok: false, state: 'pending', run, message }  — not completed yet
 *   { ok: false, state: 'failed',  run, message }  — completed, not success
 *   { ok: false, state: 'missing', message }       — no main CI run at all
 */
export function ciVerdict(runs, sha) {
  const short = String(sha).slice(0, 10);
  const candidates = relevantRuns(runs, sha);

  if (candidates.length === 0) {
    return {
      ok: false,
      state: 'missing',
      message:
        `no ${CI_WORKFLOW} run on a push to ${MAIN_BRANCH} for ${sha}. Either this commit ` +
        `is not on ${MAIN_BRANCH} (release tags come off merged main — a SHA that never ` +
        `landed there can never have a main CI run), or CI never ran for it. ` +
        `Release a commit that main CI has passed.`,
    };
  }

  const run = latestRun(candidates);
  const url = run.html_url ?? `run ${run.id}`;
  const attempt = run.run_attempt > 1 ? `, attempt ${run.run_attempt}` : '';

  if (run.status !== 'completed') {
    return {
      ok: false,
      state: 'pending',
      run,
      message: `CI still running for ${short} (${run.status}${attempt}) — wait for ${url}`,
    };
  }

  if (run.conclusion !== 'success') {
    return {
      ok: false,
      state: 'failed',
      run,
      message:
        `main CI for ${short} concluded "${run.conclusion ?? 'none'}"${attempt}: ${url}. ` +
        `A release must be cut from a SHA main CI passed. ${remedy(run)}`,
    };
  }

  return {
    ok: true,
    state: 'success',
    run,
    message: `main CI passed for ${short}${attempt}: ${url}`,
  };
}

/**
 * Fetch the candidate runs through `gh` (no shell — the SHA is an argv).
 * `{owner}/{repo}` is gh's own placeholder, resolved from the checkout's
 * remote or `GH_REPO`.
 *
 * Throws a readable Error when gh is missing or can't authenticate: the check
 * is refused, never skipped.
 */
export function fetchCiRuns(sha, { exec = execFileSync } = {}) {
  const endpoint =
    `repos/{owner}/{repo}/actions/workflows/${CI_WORKFLOW}/runs` +
    `?head_sha=${sha}&event=push&branch=${MAIN_BRANCH}&per_page=100`;
  let out;
  try {
    out = exec('gh', ['api', endpoint], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    if (e && e.code === 'ENOENT') {
      throw new Error(
        'the GitHub CLI (`gh`) is not installed, so main CI for this SHA cannot be checked. ' +
        'Install it (https://cli.github.com) and run `gh auth login`. The check is refused, not skipped.',
      );
    }
    const stderr = String(e?.stderr ?? e?.message ?? '').trim();
    throw new Error(
      `could not read ${CI_WORKFLOW} runs via gh: ${stderr || 'unknown error'}. ` +
      'If gh is not authenticated, run `gh auth login` (in Actions, set GH_TOKEN). ' +
      'The check is refused, not skipped.',
    );
  }
  const parsed = JSON.parse(out);
  return parsed.workflow_runs ?? [];
}

/**
 * Poll while the verdict is `pending`, up to `timeoutMs`, then return the last
 * verdict. Only a pending run is waited for — a missing or failed one returns
 * on the first read. Dependencies are injected so the loop is testable
 * without a clock.
 */
export async function waitForVerdict(
  sha,
  {
    fetchRuns,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    now = () => Date.now(),
    timeoutMs = 30 * 60 * 1000,
    intervalMs = 30 * 1000,
    onPending = () => {},
  },
) {
  const deadline = now() + timeoutMs;
  for (;;) {
    const verdict = ciVerdict(await fetchRuns(sha), sha);
    if (verdict.state !== 'pending') return verdict;
    if (now() + intervalMs > deadline) {
      return {
        ...verdict,
        message:
          `${verdict.message} — gave up after ${Math.round(timeoutMs / 60000)} min. ` +
          'Re-run this release job once CI has finished.',
      };
    }
    onPending(verdict);
    await sleep(intervalMs);
  }
}
