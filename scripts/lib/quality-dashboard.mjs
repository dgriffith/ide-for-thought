/**
 * The weekly quality dashboard (#2389) — pure half.
 *
 * Trends like the cancelled-main-run rate, test-step duration and ratchet
 * totals were only visible when someone ran a review. This module turns the
 * raw inputs (GitHub run/job listings, e2e job logs, Codecov totals, the
 * ratchet test files, `git log`) into ONE markdown body that
 * `.github/workflows/quality-dashboard.yml` writes into ONE issue each week —
 * the #2242 rule: one issue, updated, not a new one per run.
 *
 * Everything here is pure (strings and plain objects in, strings and plain
 * objects out) so `tests/scripts/quality-dashboard.test.ts` can pin it without
 * a network. The I/O — `gh api`, `git`, `fetch` — lives in
 * `scripts/quality-dashboard.mjs`.
 *
 * Nothing is invented. A metric whose source can't be read is rendered as
 * "unavailable" with the reason, and the CLI exits non-zero so the workflow's
 * failure step reports it — a dashboard that quietly shows a stale or made-up
 * number is worse than no dashboard.
 */

/** Title of the one dashboard issue. Find-or-create matches on it + the label. */
export const DASHBOARD_TITLE = 'Quality dashboard (weekly)';
/** Label that marks the dashboard issue. */
export const DASHBOARD_LABEL = 'quality-dashboard';

/** bench.yml's gate-failure issue title — the test pins it to bench.yml's text. */
export const BENCH_ISSUE_TITLE = 'Bench: the regression gate is failing on main';

/** Step names whose durations are trended. Matched by step name in any job, so
 *  the trend survives the step moving between jobs (#2432 moved
 *  `Test + coverage` out of `lint-and-test` into its own `coverage` job). */
export const TRENDED_STEPS = ['Test', 'Test + coverage'];

/** The e2e job, whose log carries the flake-report summary line. */
export const E2E_JOB = 'e2e';

/** Areas reported from Codecov — one per Electron process, plus the CLI. */
export const COVERAGE_AREAS = [
  { label: 'main', path: 'src/main/' },
  { label: 'renderer', path: 'src/renderer/' },
  { label: 'shared', path: 'src/shared/' },
  { label: 'cli', path: 'src/cli/' },
];

/**
 * The ratchet baselines, read from their source of truth — the constant in the
 * test that enforces each one — rather than copied here. A renamed or deleted
 * constant makes `measureRatchet` throw, and
 * `tests/scripts/quality-dashboard.test.ts` measures every entry against the
 * real files, so this list can't silently drift from the tests it describes.
 *
 *   kind 'record-sum'  `{ 'path': <n>, … }` — reports the sum of the values
 *                      (sites) and the key count (files).
 *   kind 'entries'     any object/array/`new Set([...])` literal — reports the
 *                      number of top-level entries.
 *   kind 'json-array'  a JSON file — reports the length of the array at `key`.
 */
export const RATCHETS = [
  { label: 'Swallowed errors — `catch {}` blocks', file: 'tests/architecture/pattern-ratchets.test.ts', name: 'SWALLOW_BASELINE', kind: 'record-sum' },
  { label: 'Swallowed errors — `.catch(() => …)`', file: 'tests/architecture/pattern-ratchets.test.ts', name: 'SWALLOW_EXPR_BASELINE', kind: 'record-sum' },
  { label: 'No-project `null` returns', file: 'tests/architecture/pattern-ratchets.test.ts', name: 'NO_PROJECT_NULL_BASELINE', kind: 'record-sum' },
  { label: 'No-project `undefined` returns', file: 'tests/architecture/pattern-ratchets.test.ts', name: 'NO_PROJECT_UNDEFINED_BASELINE', kind: 'record-sum' },
  { label: 'Boolean-overload returns', file: 'tests/architecture/pattern-ratchets.test.ts', name: 'BOOLEAN_OVERLOAD_BASELINE', kind: 'record-sum' },
  { label: 'In-band `error?` on a payload', file: 'tests/architecture/pattern-ratchets.test.ts', name: 'IN_BAND_ERROR_ON_PAYLOAD_BASELINE', kind: 'record-sum' },
  { label: 'Non-atomic JSON writes', file: 'tests/architecture/pattern-ratchets.test.ts', name: 'NON_ATOMIC_JSON_WRITE_BASELINE', kind: 'record-sum' },
  { label: 'Per-project state outside `createProjectStore` (`KNOWN_UNREGISTERED`)', file: 'tests/architecture/project-state-registered.test.ts', name: 'KNOWN_UNREGISTERED', kind: 'entries' },
  { label: 'Package cycles (`KNOWN_PACKAGE_CYCLES`)', file: 'tests/architecture/no-package-cycles.test.ts', name: 'KNOWN_PACKAGE_CYCLES', kind: 'entries' },
  { label: 'IPC registrars without a test (`KNOWN_UNTESTED`)', file: 'tests/architecture/ipc-registrar-coverage.test.ts', name: 'KNOWN_UNTESTED', kind: 'entries' },
  { label: 'Loose main files without a coverage floor (`KNOWN_UNENROLLED`)', file: 'tests/architecture/coverage-floor-enrollment.test.ts', name: 'KNOWN_UNENROLLED', kind: 'entries' },
  { label: 'Hand-rolled config readers', file: 'tests/architecture/config-loader-usage.test.ts', name: 'BASELINE', kind: 'entries' },
  { label: 'Dialogs not on the shared `Dialog.svelte` shell', file: 'tests/architecture/ui-dialog-adoption.test.ts', name: 'UNMIGRATED_BASELINE', kind: 'entries' },
  { label: 'Zero-state passthrough stores', file: 'tests/architecture/store-state-ownership.test.ts', name: 'ZERO_STATE_STORE_BASELINE', kind: 'entries' },
  { label: 'Graph tests exempt from the temp-project fixture', file: 'tests/architecture/graph-tests-use-temp-project-fixture.test.ts', name: 'EXEMPT', kind: 'entries' },
  { label: 'Files over 600 lines (file-size budgets)', file: 'tests/architecture/file-size-budgets.test.ts', name: 'BUDGETS', kind: 'entries' },
  { label: 'Accepted full-tree audit advisories', file: 'build/audit-baseline.json', key: 'advisories', kind: 'json-array' },
];

// ── Reading a literal out of TypeScript source ──────────────────────────────

/**
 * Remove comments while leaving string contents intact, so a `// 'x': 1` or a
 * comma inside a comment doesn't count as an entry.
 */
export function stripComments(src) {
  let out = '';
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    const n = src[i + 1];
    if (c === '/' && n === '/') {
      while (i < src.length && src[i] !== '\n') i++;
      out += '\n';
    } else if (c === '/' && n === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i++;
    } else if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < src.length && src[j] !== c) j += src[j] === '\\' ? 2 : 1;
      out += src.slice(i, j + 1);
      i = j;
    } else {
      out += c;
    }
  }
  return out;
}

/**
 * The top-level entries of the object/array literal assigned to `const name`,
 * as trimmed source strings. Handles `new Set<string>([…])` and type
 * annotations (`: Readonly<Record<string, string>>`). Throws when the constant
 * isn't there, or isn't initialised by a literal — a rename must fail loudly.
 */
export function literalEntries(src, name) {
  // Find the declaration in the raw text, then strip comments only from there
  // on: the scanner is not a full TS lexer (a regex literal containing a quote
  // would confuse it), and nothing before the declaration matters.
  const start = new RegExp(`^[ \\t]*(?:export\\s+)?const\\s+${name}\\b`, 'm').exec(src);
  if (!start) throw new Error(`const ${name} not found`);
  const code = stripComments(src.slice(start.index));
  const decl = new RegExp(`\\bconst\\s+${name}\\b[^=]*=`).exec(code);
  if (!decl) throw new Error(`const ${name} not found`);
  let i = decl.index + decl[0].length;
  while (i < code.length && code[i] !== '{' && code[i] !== '[' && code[i] !== ';') i++;
  if (code[i] !== '{' && code[i] !== '[') throw new Error(`const ${name} is not initialised by an object/array literal`);

  const entries = [];
  let depth = 0;
  let current = '';
  for (; i < code.length; i++) {
    const c = code[i];
    if (c === "'" || c === '"' || c === '`') {
      let j = i + 1;
      while (j < code.length && code[j] !== c) j += code[j] === '\\' ? 2 : 1;
      current += code.slice(i, j + 1);
      i = j;
      continue;
    }
    if (c === '{' || c === '[' || c === '(') {
      depth++;
      if (depth === 1) continue;
    } else if (c === '}' || c === ']' || c === ')') {
      depth--;
      if (depth === 0) {
        if (current.trim()) entries.push(current.trim());
        return entries;
      }
    } else if (c === ',' && depth === 1) {
      if (current.trim()) entries.push(current.trim());
      current = '';
      continue;
    }
    current += c;
  }
  throw new Error(`const ${name}: unterminated literal`);
}

/**
 * Measure one ratchet from the text of its source file.
 * @returns {{ value: number, detail: string | null }}
 */
export function measureRatchet(ratchet, src) {
  if (ratchet.kind === 'json-array') {
    const arr = JSON.parse(src)[ratchet.key];
    if (!Array.isArray(arr)) throw new Error(`${ratchet.file}: \`${ratchet.key}\` is not an array`);
    return { value: arr.length, detail: null };
  }
  const entries = literalEntries(src, ratchet.name);
  if (ratchet.kind === 'entries') return { value: entries.length, detail: null };
  if (ratchet.kind === 'record-sum') {
    let sum = 0;
    for (const e of entries) {
      const m = /:\s*(\d+)\s*$/.exec(e);
      if (!m) throw new Error(`const ${ratchet.name}: entry is not \`'key': <number>\`: ${e}`);
      sum += Number(m[1]);
    }
    return { value: sum, detail: `${entries.length} file${entries.length === 1 ? '' : 's'}` };
  }
  throw new Error(`unknown ratchet kind ${ratchet.kind}`);
}

// ── CI runs ──────────────────────────────────────────────────────────────────

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Week buckets ending at `now`, newest first. Bucket 0 is the last 7 days.
 * @returns {Array<{ start: Date, end: Date, label: string }>}
 */
export function weekBuckets(now, weeks) {
  const out = [];
  for (let i = 0; i < weeks; i++) {
    const end = new Date(now.getTime() - i * 7 * DAY_MS);
    const start = new Date(end.getTime() - 7 * DAY_MS);
    out.push({ start, end, label: `${isoDate(start)} → ${isoDate(end)}` });
  }
  return out;
}

export const isoDate = (d) => d.toISOString().slice(0, 10);

/** Index of the bucket `iso` falls in, or -1. */
export function bucketOf(buckets, iso) {
  const t = Date.parse(iso);
  return buckets.findIndex((b) => t >= b.start.getTime() && t < b.end.getTime());
}

/**
 * Main-CI run outcomes per week. A run's `conclusion` is its latest attempt's
 * (a rerun to green counts as success — the same reading release-ci-gate.mjs
 * uses). Anything not completed yet is `in progress`.
 */
export function runDistribution(runs, buckets) {
  const rows = buckets.map((b) => ({ label: b.label, total: 0, success: 0, failure: 0, cancelled: 0, other: 0, inProgress: 0 }));
  for (const r of runs) {
    const i = bucketOf(buckets, r.created_at);
    if (i === -1) continue;
    const row = rows[i];
    row.total++;
    if (r.status !== 'completed') row.inProgress++;
    else if (r.conclusion === 'success') row.success++;
    else if (r.conclusion === 'failure') row.failure++;
    else if (r.conclusion === 'cancelled') row.cancelled++;
    else row.other++;
  }
  return rows;
}

/**
 * Durations (seconds) of successful runs of `stepName`, each tagged with the
 * time it started. A failed or cancelled step's duration is how long it took
 * to fail, not how long the suite takes, so it is left out.
 */
export function stepDurations(jobs, stepName) {
  const out = [];
  for (const job of jobs) {
    for (const s of job.steps ?? []) {
      if (s.name !== stepName || s.conclusion !== 'success' || !s.started_at || !s.completed_at) continue;
      const secs = (Date.parse(s.completed_at) - Date.parse(s.started_at)) / 1000;
      if (Number.isFinite(secs) && secs >= 0) out.push({ at: s.started_at, secs });
    }
  }
  return out;
}

/** The q-quantile (0..1) of a numeric list, nearest-rank; null when empty. */
export function quantile(values, q) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const rank = Math.max(1, Math.ceil(q * sorted.length));
  return sorted[rank - 1];
}

/** Per-week median / p90 / count of `{ at, secs }` samples. */
export function weeklyDurations(samples, buckets) {
  const per = buckets.map(() => []);
  for (const s of samples) {
    const i = bucketOf(buckets, s.at);
    if (i !== -1) per[i].push(s.secs);
  }
  return buckets.map((b, i) => ({
    label: b.label,
    n: per[i].length,
    median: quantile(per[i], 0.5),
    p90: quantile(per[i], 0.9),
  }));
}

/** `12m 05s` / `48s`; `—` for null. */
export function fmtDuration(secs) {
  if (secs === null || secs === undefined) return '—';
  const s = Math.round(secs);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`;
}

// ── E2E flakes ───────────────────────────────────────────────────────────────

/**
 * The summary line `scripts/lib/e2e-flake-budget.mjs`'s `formatReport` prints:
 * `E2E flake report — 15 passed, 0 failed, 1 flaky, 0 skipped`.
 * Returns the counts from the LAST such line in the log, or null when the log
 * has none (the job died before Playwright produced a report).
 */
export function parseFlakeSummary(log) {
  const re = /E2E flake report — (\d+) passed, (\d+) failed, (\d+) flaky, (\d+) skipped/g;
  let last = null;
  for (const m of log.matchAll(re)) last = m;
  if (!last) return null;
  return { passed: Number(last[1]), failed: Number(last[2]), flaky: Number(last[3]), skipped: Number(last[4]) };
}

/**
 * Per-week flake totals over e2e job ATTEMPTS — every attempt, reruns
 * included, because a rerun to green replaces the attempt people look at and
 * drops the flake from the record (#2379).
 *
 * @param attempts `{ at, summary }` where summary is parseFlakeSummary's result
 */
export function weeklyFlakes(attempts, buckets, budget) {
  const rows = buckets.map((b) => ({ label: b.label, attempts: 0, noReport: 0, flakyTests: 0, withFlake: 0, overBudget: 0 }));
  for (const a of attempts) {
    const i = bucketOf(buckets, a.at);
    if (i === -1) continue;
    const row = rows[i];
    row.attempts++;
    if (!a.summary) { row.noReport++; continue; }
    row.flakyTests += a.summary.flaky;
    if (a.summary.flaky > 0) row.withFlake++;
    if (a.summary.flaky > budget) row.overBudget++;
  }
  return rows;
}

// ── fix: commits ─────────────────────────────────────────────────────────────

/** Conventional-commit `fix:` / `fix(scope):` / `fix!:`. */
export const isFixCommit = (subject) => /^fix(\([^)]*\))?!?:/.test(subject);

/**
 * Parse `git log --format=%H%x1f%cs%x1f%s` output and keep the fix: commits.
 * @returns {Array<{ sha: string, date: string, subject: string }>}
 */
export function parseFixCommits(logText) {
  return logText
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [sha, date, subject] = line.split('\x1f');
      return { sha, date, subject: subject ?? '' };
    })
    .filter((c) => isFixCommit(c.subject));
}

// ── The dashboard issue ──────────────────────────────────────────────────────

/**
 * The one open dashboard issue among `issues` (a REST listing), or null. Both
 * the label and the exact title must match, so a human filing an issue that
 * merely carries the label is never overwritten. When several match, the
 * oldest wins — the others are someone's mistake, not the dashboard.
 */
export function findDashboardIssue(issues) {
  const matches = issues
    .filter((i) => !i.pull_request && i.state === 'open' && i.title === DASHBOARD_TITLE)
    .filter((i) => (i.labels ?? []).some((l) => (typeof l === 'string' ? l : l.name) === DASHBOARD_LABEL))
    .sort((a, b) => a.number - b.number);
  return matches[0] ?? null;
}

// ── Rendering ────────────────────────────────────────────────────────────────

const pct = (n, d) => (d > 0 ? `${((100 * n) / d).toFixed(0)}%` : '—');

function table(header, rows) {
  return [
    `| ${header.join(' | ')} |`,
    `|${header.map(() => '---').join('|')}|`,
    ...rows.map((r) => `| ${r.join(' | ')} |`),
  ].join('\n');
}

function unavailable(err) {
  return `_Unavailable: ${String(err).split('\n')[0]}_`;
}

/**
 * Render the whole dashboard. Every section field is either its data or
 * `{ error }`; a section with an error renders as unavailable rather than as
 * zeros.
 */
export function renderDashboard(d) {
  const out = [];
  out.push(`# ${DASHBOARD_TITLE}`);
  out.push('');
  out.push(
    `Generated ${d.generatedAt.toISOString().replace(/\.\d+Z$/, 'Z')} for \`${d.ref}\` ` +
      `(${d.sha.slice(0, 8)})${d.runUrl ? ` by [this run](${d.runUrl})` : ''}. ` +
      `Windows are the last ${d.weeks} weeks, newest first. ` +
      'Updated in place weekly by `.github/workflows/quality-dashboard.yml` (#2389) — ' +
      'the edit history of this description is the time series.',
  );

  // Main CI
  out.push('', '## Main CI results (`ci.yml`, push to `main`)', '');
  if (d.ci.error) out.push(unavailable(d.ci.error));
  else {
    out.push(table(
      ['Week', 'Runs', 'Success', 'Failure', 'Cancelled', 'Other', 'In progress'],
      d.ci.rows.map((r) => [r.label, r.total, `${r.success} (${pct(r.success, r.total)})`, r.failure, r.cancelled, r.other, r.inProgress]),
    ));
    out.push('', 'A run reads as its latest attempt, so a rerun to green is a success. ' +
      'Since #2352 (2026-09-27) concurrency never cancels a main run, so a cancelled one after that date was cancelled by hand.');
  }

  // Step durations
  out.push('', '## Test step duration (successful attempts, all jobs)', '');
  if (d.durations.error) out.push(unavailable(d.durations.error));
  else {
    const steps = Object.keys(d.durations.byStep);
    const header = ['Week', ...steps.flatMap((s) => [`\`${s}\` median`, 'p90', 'n'])];
    const rows = d.durations.byStep[steps[0]].map((_, i) => [
      d.durations.byStep[steps[0]][i].label,
      ...steps.flatMap((s) => {
        const w = d.durations.byStep[s][i];
        return [fmtDuration(w.median), fmtDuration(w.p90), w.n];
      }),
    ]);
    out.push(table(header, rows));
  }

  // E2E flakes
  out.push('', '## E2E flakes (main, every attempt incl. reruns)', '');
  if (d.flakes.error) out.push(unavailable(d.flakes.error));
  else {
    out.push(table(
      ['Week', 'e2e attempts', 'Flaky tests (sum)', 'Attempts with a flake', `Over budget (>${d.flakes.budget})`, 'No report'],
      d.flakes.rows.map((r) => [r.label, r.attempts, r.flakyTests, r.withFlake, r.overBudget, r.noReport]),
    ));
    out.push('', 'From the `E2E flake report — …` line `scripts/e2e-flake-report.mjs` prints. ' +
      '"No report" = the job ended before Playwright wrote one (packaging failed, cancelled, or the log has expired).');
  }

  // Bench
  out.push('', '## Bench (`bench.yml`)', '');
  if (d.bench.error) out.push(unavailable(d.bench.error));
  else {
    const s = d.bench.latestScheduled;
    out.push(s
      ? `Latest scheduled run: **${s.conclusion ?? s.status}** on ${s.created_at.slice(0, 10)} — [run](${s.html_url}).`
      : 'No scheduled run in the listing.');
    out.push(d.bench.openIssue
      ? `Open gate-failure issue: #${d.bench.openIssue.number}.`
      : 'No open gate-failure issue.');
    if (d.bench.recent.length) {
      out.push('', table(['Run', 'Event', 'Result'], d.bench.recent.map((r) =>
        [`[${r.created_at.slice(0, 10)}](${r.html_url})`, r.event, r.conclusion ?? r.status])));
    }
  }

  // Coverage
  out.push('', '## Coverage by process (Codecov, latest `main` report)', '');
  if (d.coverage.error) out.push(unavailable(d.coverage.error));
  else {
    out.push(table(
      ['Area', 'Lines', 'Hits', 'Partials', 'Misses', 'Coverage'],
      d.coverage.rows.map((r) => r.error
        ? [`\`${r.path}\``, unavailable(r.error), '', '', '', '']
        : [`\`${r.path}\` (${r.label})`, r.lines, r.hits, r.partials, r.misses, `${r.coverage.toFixed(2)}%`]),
    ));
    out.push('', "Codecov's line coverage (hits ÷ lines — a partially covered line counts against it), " +
      'so it reads lower than vitest\'s per-area floors in `vitest.config.mts`, which are the gate. Trend it, don\'t compare it to them.');
  }

  // Ratchets
  out.push('', '## Ratchet baselines (each may only shrink)', '');
  if (d.ratchets.error) out.push(unavailable(d.ratchets.error));
  else {
    out.push(table(
      ['Ratchet', 'Now', `${d.ratchets.sinceLabel}`, 'Δ', 'Source'],
      d.ratchets.rows.map((r) => {
        const now = r.error ? unavailable(r.error) : `${r.value}${r.detail ? ` (${r.detail})` : ''}`;
        const then = r.previous === null || r.previous === undefined ? '—' : String(r.previous);
        const delta = r.error || r.previous === null || r.previous === undefined ? '—'
          : r.value - r.previous === 0 ? '0' : (r.value - r.previous > 0 ? `+${r.value - r.previous}` : String(r.value - r.previous));
        return [r.label, now, then, delta, `\`${r.file}\`${r.name ? ` \`${r.name}\`` : ''}`];
      }),
    ));
    out.push('', 'Read from the constant in the test that enforces each one — see `docs/architecture-ratchets.md`.');
  }

  // fix: commits
  out.push('', '## `fix:` commits since the last release', '');
  if (d.fixes.error) out.push(unavailable(d.fixes.error));
  else {
    out.push(`**${d.fixes.commits.length}** \`fix:\` commit${d.fixes.commits.length === 1 ? '' : 's'} on \`${d.ref}\` since \`${d.fixes.tag}\` ` +
      `(${d.fixes.tagDate}), out of ${d.fixes.total} commits.`);
    const shown = d.fixes.commits.slice(0, 40);
    if (shown.length) {
      out.push('', ...shown.map((c) => `- ${c.date} ${c.sha.slice(0, 8)} ${c.subject}`));
      if (d.fixes.commits.length > shown.length) out.push(`- … and ${d.fixes.commits.length - shown.length} more`);
    }
  }

  const errors = collectErrors(d);
  if (errors.length) {
    out.push('', '## Unavailable this week', '', ...errors.map((e) => `- ${e}`));
  }
  out.push('');
  // GitHub caps an issue body at 65536 characters.
  const body = out.join('\n');
  return body.length > 65000 ? `${body.slice(0, 64900)}\n\n_(truncated)_\n` : body;
}

/** Every section/row error, as `section: message` lines. */
export function collectErrors(d) {
  const errs = [];
  for (const key of ['ci', 'durations', 'flakes', 'bench', 'coverage', 'ratchets', 'fixes']) {
    if (d[key]?.error) errs.push(`${key}: ${String(d[key].error).split('\n')[0]}`);
  }
  for (const r of d.coverage?.rows ?? []) if (r.error) errs.push(`coverage ${r.path}: ${r.error}`);
  for (const r of d.ratchets?.rows ?? []) if (r.error) errs.push(`ratchet ${r.label}: ${r.error}`);
  return errs;
}
