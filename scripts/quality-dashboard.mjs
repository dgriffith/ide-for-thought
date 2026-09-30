#!/usr/bin/env node
/**
 * Weekly quality dashboard (#2389) — the I/O half.
 *
 * Gathers the metrics, renders them with `scripts/lib/quality-dashboard.mjs`
 * (pure, tested), and either prints the markdown (the default — a dry run) or,
 * with `--publish`, writes it into the ONE dashboard issue: find by label +
 * exact title, create if absent, pin it (best-effort), and edit its body in
 * place every week. One issue, updated — the #2242 rule for anything that
 * reports from outside the PR loop.
 *
 * Sources, and why each is cheap:
 *   - main CI runs / step durations / e2e flake lines: the Actions REST API
 *     through `gh api` (one listing, one jobs call per run, one log per e2e
 *     attempt — every attempt, so a rerun to green can't hide a flake, #2379).
 *   - bench status: `bench.yml`'s run listing + its gate-failure issue.
 *   - coverage by process: Codecov's public totals API for the latest `main`
 *     report — the `coverage` job already uploads there on every main push,
 *     so the dashboard reads that rather than re-running an 11-minute
 *     instrumented suite.
 *   - ratchet totals: the baseline constants in the tests that enforce them,
 *     at HEAD and at the commit from one window ago (`git show`).
 *   - `fix:` commits: `git log <last v* tag>..HEAD`.
 *
 * Any source that fails is rendered as "unavailable", never as zeros; the
 * dashboard is still written, and the process then exits 1 so the workflow's
 * failure step says which section broke.
 *
 * Usage:
 *   node scripts/quality-dashboard.mjs [--repo owner/name] [--weeks 4]
 *        [--out dashboard.md] [--publish]
 *
 * Needs `gh` authenticated (GH_TOKEN in CI) and a clone with history + tags
 * (`fetch-depth: 0`).
 */
import { execFile } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { FLAKE_BUDGET } from './lib/e2e-flake-budget.mjs';
import {
  BENCH_ISSUE_TITLE,
  COVERAGE_AREAS,
  DASHBOARD_LABEL,
  DASHBOARD_TITLE,
  E2E_JOB,
  RATCHETS,
  TRENDED_STEPS,
  collectErrors,
  findDashboardIssue,
  isoDate,
  measureRatchet,
  parseFixCommits,
  parseFlakeSummary,
  renderDashboard,
  runDistribution,
  stepDurations,
  weekBuckets,
  weeklyDurations,
  weeklyFlakes,
} from './lib/quality-dashboard.mjs';

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;

function parseArgs(argv) {
  const args = { weeks: 4, publish: false, repo: process.env.GITHUB_REPOSITORY ?? null, out: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--publish') args.publish = true;
    else if (a === '--repo') args.repo = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--weeks') {
      args.weeks = Number(argv[++i]);
      if (!Number.isInteger(args.weeks) || args.weeks < 1 || args.weeks > 12) throw new Error('--weeks must be 1..12');
    } else throw new Error(`unknown argument: ${a}`);
  }
  return args;
}

async function git(...a) {
  const { stdout } = await run('git', a, { maxBuffer: MAX_BUFFER });
  return stdout;
}

async function gh(...a) {
  const { stdout } = await run('gh', a, { maxBuffer: MAX_BUFFER });
  return stdout;
}

/** `gh api --paginate` with a jq filter emitting one JSON value per line. */
async function ghLines(path, jq) {
  const out = await gh('api', '--paginate', path, '--jq', jq);
  return out.split('\n').filter(Boolean).map((l) => JSON.parse(l));
}

/** Run `fn` over `items` with at most `limit` in flight. */
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  }));
  return results;
}

/** Wrap a section so a failure becomes `{ error }` instead of aborting. */
async function section(name, fn) {
  try {
    return await fn();
  } catch (e) {
    console.error(`quality-dashboard: ${name} unavailable: ${e?.stderr || e?.message || e}`);
    return { error: String(e?.stderr || e?.message || e).trim() };
  }
}

// ── Gatherers ────────────────────────────────────────────────────────────────

async function mainCiRuns(repo, since) {
  return ghLines(
    `repos/${repo}/actions/workflows/ci.yml/runs?branch=main&event=push&created=>=${since.toISOString()}&per_page=100`,
    '.workflow_runs[] | {id, status, conclusion, created_at, run_attempt, html_url}',
  );
}

/** Every job of every attempt of each run (`filter=all`). */
async function jobsFor(repo, runs) {
  const perRun = await pool(runs, 8, (r) =>
    ghLines(
      `repos/${repo}/actions/runs/${r.id}/jobs?filter=all&per_page=100`,
      '.jobs[] | {id, name, status, conclusion, run_attempt, started_at, completed_at, steps: [.steps[]? | {name, conclusion, started_at, completed_at}]}',
    ),
  );
  return perRun.flat();
}

async function flakeAttempts(repo, jobs) {
  const e2e = jobs.filter((j) => j.name === E2E_JOB && j.status === 'completed' && j.conclusion !== 'skipped');
  return pool(e2e, 6, async (j) => {
    let log = '';
    try {
      log = await gh('api', `repos/${repo}/actions/jobs/${j.id}/logs`);
    } catch {
      // Expired or never-written log: counted as "no report", not as 0 flakes.
      // (A 410/404 here is the documented shape of an expired log.)
    }
    return { at: j.started_at, summary: parseFlakeSummary(log) };
  });
}

async function bench(repo) {
  const recent = await ghLines(
    `repos/${repo}/actions/workflows/bench.yml/runs?per_page=10`,
    '.workflow_runs[] | {event, status, conclusion, created_at, html_url}',
  );
  // Only the first page: --paginate would walk the whole history.
  const open = JSON.parse(await gh('api', `repos/${repo}/issues?state=open&per_page=100`));
  const openIssue = open.find((i) => !i.pull_request && i.title === BENCH_ISSUE_TITLE) ?? null;
  return {
    recent: recent.slice(0, 5),
    latestScheduled: recent.find((r) => r.event === 'schedule') ?? null,
    openIssue: openIssue ? { number: openIssue.number } : null,
  };
}

async function coverage(repo) {
  const [owner, name] = repo.split('/');
  const base = `https://api.codecov.io/api/v2/github/${owner}/repos/${name}`;
  const branch = await fetch(`${base}/branches/main/`);
  if (!branch.ok) throw new Error(`Codecov branches/main: HTTP ${branch.status}`);
  const head = (await branch.json()).head_commit?.commitid ?? null;
  const rows = await Promise.all(COVERAGE_AREAS.map(async (a) => {
    try {
      const r = await fetch(`${base}/totals/?branch=main&path=${encodeURIComponent(a.path)}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const t = (await r.json()).totals;
      if (!t || !t.lines) throw new Error('no lines reported for this path');
      return { ...a, lines: t.lines, hits: t.hits, partials: t.partials, misses: t.misses, coverage: Number(t.coverage) };
    } catch (e) {
      return { ...a, error: String(e.message ?? e) };
    }
  }));
  return { head, rows };
}

async function ratchets(since) {
  const then = (await git('rev-list', '-1', `--before=${since.toISOString()}`, 'HEAD')).trim() || null;
  const rows = await Promise.all(RATCHETS.map(async (r) => {
    const row = { label: r.label, file: r.file, name: r.name ?? null, previous: null };
    try {
      Object.assign(row, measureRatchet(r, readFileSync(r.file, 'utf-8')));
    } catch (e) {
      return { ...row, error: String(e.message ?? e) };
    }
    if (then) {
      try {
        row.previous = measureRatchet(r, await git('show', `${then}:${r.file}`)).value;
      } catch {
        row.previous = null; // file or constant didn't exist yet — nothing to compare
      }
    }
    return row;
  }));
  return { rows, sinceLabel: then ? `At ${then.slice(0, 8)} (${isoDate(since)})` : 'Previous' };
}

async function fixes() {
  const tag = (await git('describe', '--tags', '--abbrev=0', '--match', 'v[0-9]*', 'HEAD')).trim();
  const tagDate = (await git('log', '-1', '--format=%cs', tag)).trim();
  const log = await git('log', '--format=%H%x1f%cs%x1f%s', `${tag}..HEAD`);
  const total = log.split('\n').filter(Boolean).length;
  return { tag, tagDate, total, commits: parseFixCommits(log) };
}

// ── Publishing ───────────────────────────────────────────────────────────────

async function publish(repo, body) {
  // The label may not exist on a fresh repo; creating it is idempotent enough
  // (422 = already exists).
  try {
    await gh('api', `repos/${repo}/labels`, '-f', `name=${DASHBOARD_LABEL}`, '-f', 'color=5319e7',
      '-f', 'description=The weekly quality dashboard issue (#2389)');
  } catch { /* already exists */ }

  const issues = JSON.parse(await gh('api', `repos/${repo}/issues?state=open&labels=${DASHBOARD_LABEL}&per_page=100`));
  const existing = findDashboardIssue(issues);
  const bodyFile = join(mkdtempSync(join(tmpdir(), 'quality-dashboard-')), 'body.json');
  writeFileSync(bodyFile, JSON.stringify({ body }));
  let issue;
  if (existing) {
    issue = JSON.parse(await gh('api', '--method', 'PATCH', `repos/${repo}/issues/${existing.number}`, '--input', bodyFile));
    console.log(`quality-dashboard: updated #${issue.number}`);
  } else {
    writeFileSync(bodyFile, JSON.stringify({ title: DASHBOARD_TITLE, body, labels: [DASHBOARD_LABEL] }));
    issue = JSON.parse(await gh('api', '--method', 'POST', `repos/${repo}/issues`, '--input', bodyFile));
    console.log(`quality-dashboard: created #${issue.number}`);
  }
  // Pin it so it's the first thing on the Issues tab. Best-effort: pinning
  // needs a permission GITHUB_TOKEN may not carry, there are only three pin
  // slots, and none of that should stop the dashboard being written.
  try {
    const pinned = JSON.parse(await gh('api', 'graphql', '-f', `query=query($id: ID!) { node(id: $id) { ... on Issue { isPinned } } }`,
      '-f', `id=${issue.node_id}`));
    if (!pinned.data?.node?.isPinned) {
      await gh('api', 'graphql', '-f', 'query=mutation($id: ID!) { pinIssue(input: { issueId: $id }) { issue { number } } }',
        '-f', `id=${issue.node_id}`);
      console.log(`quality-dashboard: pinned #${issue.number}`);
    }
  } catch (e) {
    console.log(`::warning title=Quality dashboard not pinned::#${issue.number} could not be pinned: ${String(e?.stderr || e?.message || e).split('\n')[0]}`);
  }
  return issue.number;
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.repo) throw new Error('--repo owner/name is required (or set GITHUB_REPOSITORY)');
  if (!existsSync('package.json')) throw new Error('run from the repository root');

  const now = new Date();
  const buckets = weekBuckets(now, args.weeks);
  const since = buckets[buckets.length - 1].start;

  const runsP = section('main CI runs', () => mainCiRuns(args.repo, since));
  const runs = await runsP;
  const jobs = runs.error ? runs : await section('CI jobs', () => jobsFor(args.repo, runs));

  const [flakes, benchData, cov, ratchetData, fixData] = await Promise.all([
    jobs.error ? jobs : section('e2e flakes', async () =>
      ({ budget: FLAKE_BUDGET, rows: weeklyFlakes(await flakeAttempts(args.repo, jobs), buckets, FLAKE_BUDGET) })),
    section('bench', () => bench(args.repo)),
    section('coverage', () => coverage(args.repo)),
    // Ratchets compare against a week ago — the previous dashboard — rather
    // than the start of the window; the issue's edit history is the long trend.
    section('ratchets', () => ratchets(buckets[0].start)),
    section('fix commits', () => fixes()),
  ]);

  const data = {
    generatedAt: now,
    weeks: args.weeks,
    ref: process.env.GITHUB_REF_NAME ?? (await git('rev-parse', '--abbrev-ref', 'HEAD')).trim(),
    sha: (await git('rev-parse', 'HEAD')).trim(),
    runUrl: process.env.GITHUB_RUN_ID
      ? `${process.env.GITHUB_SERVER_URL}/${args.repo}/actions/runs/${process.env.GITHUB_RUN_ID}`
      : null,
    ci: runs.error ? runs : { rows: runDistribution(runs, buckets) },
    durations: jobs.error ? jobs : {
      byStep: Object.fromEntries(TRENDED_STEPS.map((s) => [s, weeklyDurations(stepDurations(jobs, s), buckets)])),
    },
    flakes,
    bench: benchData,
    coverage: cov,
    ratchets: ratchetData,
    fixes: fixData,
  };

  const body = renderDashboard(data);
  if (args.out) writeFileSync(args.out, body);
  if (args.publish) await publish(args.repo, body);
  else if (!args.out) process.stdout.write(body);

  const errors = collectErrors(data);
  if (errors.length) {
    for (const e of errors) console.log(`::error title=Quality dashboard section unavailable::${e}`);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(`quality-dashboard: ${e?.stack ?? e}`);
  process.exit(1);
});
